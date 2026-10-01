import { Prisma } from '@catwalks/db';
import { createHash } from 'node:crypto';
import { searchWords, type SearchClause, type SearchIntent } from './search-intent';

const identity = (kind: string, key: string) => `cwi${createHash('md5').update(kind + ':' + key).digest('hex')}`;
const identityQuery = (kind: string, keys: string[]) => Prisma.sql`to_tsquery('simple', ${keys.map(k => identity(kind, k)).join(' | ')})`;
function textQuery(c: SearchClause) {
  const weights = c.kind === 'company' ? 'AB' : ['role', 'family'].includes(c.kind) ? 'AC' : '';
  const query = c.phrases.map(p => {
    const effectiveWeights = c.titleOnlyPhrases?.includes(p) ? 'A' : weights;
    return '(' + searchWords(p).map(w => `'${w}'${effectiveWeights ? ':' + effectiveWeights : ''}`).join(' <-> ') + ')';
  }).join(' | ');
  return Prisma.sql`to_tsquery('simple', ${query})`;
}
/** D-500 (Q4) : les expressions d'une clause cherchées dans le seul intitulé (poids A du document). */
function titreQuery(c: SearchClause) {
  const query = c.phrases.map(p => '(' + searchWords(p).map(w => `'${w}':A`).join(' <-> ') + ')').join(' | ');
  return Prisma.sql`to_tsquery('simple', ${query})`;
}
/**
 * D-500 (Q4) — LE RANG D'UNE OFFRE, avant la pertinence des mots : 2 si son intitulé contient la requête (chaque clause
 * de métier, de famille ou de mots y est écrite, sous l'une de ses expressions), 1 si elle porte un métier cherché (code
 * ou métier lu dans l'intitulé), 0 si elle n'est trouvée que par sa description ou ses missions. Une offre trouvée par
 * ses missions (« Vendeur » pour « responsable de boutique ») passe donc après toutes celles qui nomment le métier.
 * Avec un lieu, la distance reste devant (`job-search-query.ts`) : le rang départage à la même distance.
 */
// La pertinence des mots vaut au plus 2 par clause (ts_rank_cd normalisé, plus 1 pour l'identité), 128 pour 64 clauses :
// les rangs la dominent toujours, et le score quantifié (×1e6) reste un entier de 32 bits (1 128 × 1e6 < 2^31).
export const RANG_TITRE = 1000, RANG_METIER = 500;
function rangSql(intent: SearchIntent) {
  const lues = intent.clauses.filter(c => !c.exclude && ['role', 'family', 'text'].includes(c.kind) && c.phrases.length);
  if (!lues.length) return null;
  const roles = lues.filter(c => c.kind === 'role').flatMap(c => c.keys);
  const titre = Prisma.sql`s.vector @@ (${Prisma.join(lues.map(titreQuery), ' && ')})`;
  return roles.length
    ? Prisma.sql`(CASE WHEN ${titre} THEN ${RANG_TITRE} WHEN s.vector @@ ${identityQuery('role', roles)} THEN ${RANG_METIER} ELSE 0 END)`
    : Prisma.sql`(CASE WHEN ${titre} THEN ${RANG_TITRE} ELSE 0 END)`;
}
/** One GIN condition: each resolved intention is required, with native text OR
 * semantic evidence within it. Fixed alias s; user values are all bound.
 *
 * D-488 : avec `metiersSansIndex`, chaque clause de métier devient une condition à part, vérifiée document par document
 * dans le périmètre (`coalesce` rend l'index plein texte inutilisable pour elle) ; les autres clauses gardent la condition
 * indexable. Les résultats sont les mêmes (`v @@ (A && B)` vaut `v @@ A AND v @@ B`, `v @@ !!A` vaut `NOT v @@ A`) ; seul
 * le chemin change. Qui choisit, et pourquoi : `search-chemin.ts`. */
export function searchSql(intent: SearchIntent, options: { metiersSansIndex?: boolean; classement?: boolean } = {}) {
  const sansIndex = (c: SearchClause) => !!options.metiersSansIndex && c.kind === 'role';
  const trouve = (c: SearchClause) => {
    const lexical = Prisma.sql`(${textQuery(c)})`;
    const native = c.kind === 'role' ? Prisma.sql`(${lexical} && !!to_tsquery('simple','cwhastitlerole'))` : lexical;
    return c.kind === 'text' ? lexical : Prisma.sql`(${native} || ${identityQuery(c.kind, c.keys)})`;
  };
  const indexables = intent.clauses.filter(c => !sansIndex(c)).map(c => c.exclude ? Prisma.sql`!!(${trouve(c)})` : trouve(c));
  const clauses = [
    ...(indexables.length ? [Prisma.sql`s.vector @@ (${Prisma.join(indexables, ' && ')})`] : []),
    ...intent.clauses.filter(sansIndex).map(c => c.exclude
      ? Prisma.sql`NOT (coalesce(s.vector, ''::tsvector) @@ ${trouve(c)})` : Prisma.sql`coalesce(s.vector, ''::tsvector) @@ ${trouve(c)}`),
  ];
  const scores = intent.clauses.filter(c => !c.exclude).map(c => {
    const lexical = Prisma.sql`ts_rank_cd(ARRAY[0.05,0.1,0.5,1.0]::real[],s.vector,(${textQuery(c)}),32)`;
    const keys = c.kind === 'text' ? c.preferCompanyKeys : c.keys;
    const bonus = keys?.length ? Prisma.sql`CASE WHEN s.vector @@ ${identityQuery(c.kind === 'text' ? 'company' : c.kind, keys)} THEN 1.0 ELSE 0 END` : Prisma.sql`0`;
    return Prisma.sql`(${lexical} + ${bonus})`;
  });
  // D-500 (Q4), contrat 2 seulement : le rang par l'intitulé s'ajoute à la pertinence (sans l'option, le score d'avant).
  const rang = options.classement ? rangSql(intent) : null;
  if (rang) scores.unshift(rang);
  return {
    condition: clauses.length === 1 ? clauses[0] : clauses.length ? Prisma.sql`(${Prisma.join(clauses, ' AND ')})` : Prisma.sql`false`,
    // Quantize once to a stable integer; JSON and PostgreSQL cursor ordering agree.
    score: scores.length ? Prisma.sql`round((${Prisma.join(scores, ' + ')})::numeric * 1000000)::int` : Prisma.sql`0`,
  };
}
