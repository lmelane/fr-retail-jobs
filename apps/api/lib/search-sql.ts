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
