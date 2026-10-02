import { Prisma } from '@catwalks/db';
import { createHash } from 'node:crypto';
import { MOTS_DE_LIAISON, searchWords, type SearchClause, type SearchIntent } from './search-intent';

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
/**
 * Les expressions d'une clause cherchées dans le seul intitulé (poids A du document) : chaque mot de l'expression, hors
 * mots de liaison, présent dans l'intitulé, dans n'importe quel ordre. Pas une suite de mots : l'écriture inclusive
 * découpe « Conseiller·ère de vente » en « conseiller ere de vente », et une suite exacte « conseiller de vente » ne
 * reconnaîtrait plus l'intitulé qui nomme exactement la recherche (audit métier R-143 §7 du 02/10/2026).
 */
function titreQuery(c: SearchClause) {
  const query = c.phrases.map(p => {
    const mots = searchWords(p);
    const utiles = mots.filter(w => !MOTS_DE_LIAISON.has(w));
    return '(' + (utiles.length ? utiles : mots).map(w => `'${w}':A`).join(' & ') + ')';
  }).join(' | ');
  return Prisma.sql`to_tsquery('simple', ${query})`;
}
/**
 * R-143 §7 (D-513) — LES POINTS DE L'INTITULÉ d'une offre trouvée par la requête (`classement.ts`) : `requete` si son
 * intitulé contient la requête (chaque clause de métier, de famille ou de mots y est écrite, sous l'une de ses
 * expressions), `metier` si elle porte un métier cherché (code ou métier lu dans l'intitulé), 0 si elle n'est trouvée que
 * par sa description ou ses missions. Reprend le rang de D-500 Q4, retiré par D-510 quand la fraîcheur triait seule.
 * `null` : la requête ne nomme ni métier, ni famille, ni mots (une Maison seule) ; l'intitulé n'est pas comparé.
 */
export function intituleSql(intent: SearchIntent, points: { requete: number; metier: number }, metierPrincipal: Prisma.Sql): Prisma.Sql | null {
  const lues = intent.clauses.filter(c => !c.exclude && ['role', 'family', 'text'].includes(c.kind) && c.phrases.length);
  if (!lues.length) return null;
  const roles = lues.filter(c => c.kind === 'role').flatMap(c => c.keys);
  const titre = Prisma.sql`s.vector @@ (${Prisma.join(lues.map(titreQuery), ' && ')})`;
  // Le métier principal de l'offre (`occupationCode`) est le métier tapé : 40, comme le même métier choisi par le filtre
  // `metier` (`classement.ts`) ; le métier seulement lu dans l'intitulé (identité `role`) : 25 (audit technique).
  return roles.length
    ? Prisma.sql`(CASE WHEN ${titre} OR ${metierPrincipal} IN (${Prisma.join(roles.map(r => Prisma.sql`${r}`))}) THEN ${points.requete}
        WHEN s.vector @@ ${identityQuery('role', roles)} THEN ${points.metier} ELSE 0 END)`
    : Prisma.sql`(CASE WHEN ${titre} THEN ${points.requete} ELSE 0 END)`;
}
/** One GIN condition: each resolved intention is required, with native text OR
 * semantic evidence within it. Fixed alias s; user values are all bound.
 *
 * D-488 : avec `metiersSansIndex`, chaque clause de métier devient une condition à part, vérifiée document par document
 * dans le périmètre (`coalesce` rend l'index plein texte inutilisable pour elle) ; les autres clauses gardent la condition
 * indexable. Les résultats sont les mêmes (`v @@ (A && B)` vaut `v @@ A AND v @@ B`, `v @@ !!A` vaut `NOT v @@ A`) ; seul
 * le chemin change. Qui choisit, et pourquoi : `search-chemin.ts`. */
export function searchSql(intent: SearchIntent, options: { metiersSansIndex?: boolean } = {}) {
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
  return {
    condition: clauses.length === 1 ? clauses[0] : clauses.length ? Prisma.sql`(${Prisma.join(clauses, ' AND ')})` : Prisma.sql`false`,
    // Quantize once to a stable integer; JSON and PostgreSQL cursor ordering agree. D-510 : au contrat 2, le score ne
    // trie plus et n'est pas calculé (`job-search-query.ts`) ; le classement par l'intitulé de D-500 (Q4) est retiré.
    score: scores.length ? Prisma.sql`round((${Prisma.join(scores, ' + ')})::numeric * 1000000)::int` : Prisma.sql`0`,
  };
}
