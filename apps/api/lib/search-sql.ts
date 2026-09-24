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
 * semantic evidence within it. Fixed alias s; user values are all bound. */
export function searchSql(intent: SearchIntent) {
  const clauses = intent.clauses.map(c => {
    const lexical = Prisma.sql`(${textQuery(c)})`;
    const native = c.kind === 'role' ? Prisma.sql`(${lexical} && !!to_tsquery('simple','cwhastitlerole'))` : lexical;
    const found = c.kind === 'text' ? lexical : Prisma.sql`(${native} || ${identityQuery(c.kind, c.keys)})`;
    return c.exclude ? Prisma.sql`!!(${found})` : found;
  });
  const scores = intent.clauses.filter(c => !c.exclude).map(c => {
    const lexical = Prisma.sql`ts_rank_cd(ARRAY[0.05,0.1,0.5,1.0]::real[],s.vector,(${textQuery(c)}),32)`;
    const keys = c.kind === 'text' ? c.preferCompanyKeys : c.keys;
    const bonus = keys?.length ? Prisma.sql`CASE WHEN s.vector @@ ${identityQuery(c.kind === 'text' ? 'company' : c.kind, keys)} THEN 1.0 ELSE 0 END` : Prisma.sql`0`;
    return Prisma.sql`(${lexical} + ${bonus})`;
  });
  return {
    condition: clauses.length ? Prisma.sql`s.vector @@ (${Prisma.join(clauses, ' && ')})` : Prisma.sql`false`,
    // Quantize once to a stable integer; JSON and PostgreSQL cursor ordering agree.
    score: scores.length ? Prisma.sql`round((${Prisma.join(scores, ' + ')})::numeric * 1000000)::int` : Prisma.sql`0`,
  };
}
