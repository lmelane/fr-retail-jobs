import { Prisma, prisma } from '@catwalks/db';
import { createHash } from 'node:crypto';
import { searchWords, type SearchClause, type SearchIntent } from '../../lib/search-intent';
export type EngineResult = { ids: string[]; total: number; elapsedMs: number };
const column = (kind: SearchClause['kind']) => Prisma.raw({ role: 'roles', family: 'families', sector: 'sectors', company: '"companyKeys"', text: 'roles' }[kind]);
const textQuery = (c: SearchClause) => {
  const weights = c.kind === 'company' ? 'AB' : ['role', 'family'].includes(c.kind) ? 'AC' : '';
  return Prisma.join(c.phrases.map(p => {
    const effectiveWeights = c.titleOnlyPhrases?.includes(p) ? 'A' : weights;
    const query = searchWords(p).map(w => `'${w}'${effectiveWeights ? ':' + effectiveWeights : ''}`).join(' <-> ');
    return Prisma.sql`to_tsquery('simple', ${query})`;
  }), ' || ');
};
function conditionQuery(c: SearchClause) {
  const lexical = Prisma.sql`(${textQuery(c)})`;
  const identities = c.keys.map(key => `cwi${createHash('md5').update(c.kind + ':' + key).digest('hex')}`).join(' | ');
  const found = c.kind === 'text' ? lexical : Prisma.sql`(${lexical} || to_tsquery('simple', ${identities}))`;
  return c.exclude ? Prisma.sql`!!(${found})` : found;
}
export async function enrichedPostgres(intent: SearchIntent, countries: readonly string[], limit: number): Promise<EngineResult> {
  const started = performance.now();
  const positives = intent.clauses.filter(c => !c.exclude);
  const score = positives.length ? Prisma.join(positives.map(c => {
    const lexical = Prisma.sql`ts_rank_cd(ARRAY[0.05, 0.1, 0.5, 1.0]::real[], vector, (${textQuery(c)}), 32)`;
    const preferred = c.preferCompanyKeys?.length ? Prisma.sql`(CASE WHEN "companyKeys" && ARRAY[${Prisma.join(c.preferCompanyKeys)}]::text[] THEN 1.0 ELSE 0 END)` : Prisma.sql`0`;
    return c.kind === 'text' ? Prisma.sql`(${lexical} + ${preferred})` : Prisma.sql`(${lexical} + CASE WHEN ${column(c.kind)} && ARRAY[${Prisma.join(c.keys)}]::text[] THEN 1.0 ELSE 0 END)`;
  }), ' + ') : Prisma.sql`0`;
  const rows = await prisma.$queryRaw<{ ids: string[] | null; total: number }[]>(Prisma.sql`
    WITH matched AS MATERIALIZED (
      SELECT id, origin, "postedAt", "firstSeenAt", (${score}) AS score FROM benchmark_document
      WHERE country IN (${Prisma.join([...countries])})
      ${intent.clauses.length ? Prisma.sql`AND vector @@ (${Prisma.join(intent.clauses.map(conditionQuery), ' && ')})` : Prisma.empty}
    ) SELECT (SELECT count(*)::int FROM matched) AS total,
      (SELECT array_agg(id ORDER BY origin, score DESC, "postedAt" DESC, "firstSeenAt" DESC, id)
        FROM (SELECT * FROM matched ORDER BY origin, score DESC, "postedAt" DESC, "firstSeenAt" DESC, id LIMIT ${limit}) p) AS ids`);
  return { ids: rows[0].ids ?? [], total: rows[0].total, elapsedMs: performance.now() - started };
}
const FIELD = { role: 'roles', family: 'families', sector: 'sectors', company: 'companyKeys', text: 'title' };
function elasticClause(c: SearchClause) {
  const fields = c.kind === 'company' ? ['title^10', 'company^5']
    : ['role', 'family'].includes(c.kind) ? ['title^10', 'duties^1'] : ['title^10', 'company^5', 'body^0.5'];
  const should: Record<string, unknown>[] = c.phrases.map(query => ({ multi_match: {
    query, fields: c.titleOnlyPhrases?.includes(query) ? ['title^10'] : fields, type: 'phrase',
  } }));
  if (c.kind !== 'text') should.push({ constant_score: { filter: { terms: { [FIELD[c.kind]]: c.keys } }, boost: 10 } });
  if (c.preferCompanyKeys?.length) return { bool: {
    must: [{ bool: { should, minimum_should_match: 1 } }],
    should: [{ constant_score: { filter: { terms: { companyKeys: c.preferCompanyKeys } }, boost: 20 } }],
  } };
  return { bool: { should, minimum_should_match: 1 } };
}
export async function elasticsearch(intent: SearchIntent, countries: readonly string[], limit: number): Promise<EngineResult> {
  const started = performance.now();
  const response = await fetch('http://127.0.0.1:59200/catwalks-benchmark-v1/_search', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ size: limit, track_total_hits: true, _source: false,
      query: { bool: { filter: [{ terms: { country: countries } }],
        must: intent.clauses.filter(c => !c.exclude).map(elasticClause),
        must_not: intent.clauses.filter(c => c.exclude).map(elasticClause),
      } }, sort: [{ origin: 'asc' }, '_score', { postedAt: 'desc' }, { firstSeenAt: 'desc' }, { id: 'asc' }],
    }),
  });
  if (!response.ok) throw new Error(`Elasticsearch ${response.status}: ${await response.text()}`);
  const result = await response.json();
  return { ids: result.hits.hits.map((h: { _id: string }) => h._id), total: result.hits.total.value, elapsedMs: performance.now() - started };
}
