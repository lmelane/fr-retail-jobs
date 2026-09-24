import { Prisma, prisma } from '@catwalks/db';
import { searchSql } from '../../lib/search-sql';
import { type SearchClause, type SearchIntent } from '../../lib/search-intent';
export type EngineResult = { ids: string[]; total: number; elapsedMs: number };
export async function enrichedPostgres(intent: SearchIntent, countries: readonly string[], limit: number): Promise<EngineResult> {
  const started = performance.now();
  const {condition,score} = searchSql(intent);
  const rows = await prisma.$queryRaw<{ ids: string[] | null; total: number }[]>(Prisma.sql`
    WITH matched AS MATERIALIZED (
      SELECT id, origin, "postedAt", "firstSeenAt", (${score}) AS score FROM benchmark_document s
      WHERE country IN (${Prisma.join([...countries])})
      ${Prisma.sql`AND ${condition}`}
    ) SELECT (SELECT count(*)::int FROM matched) AS total,
      (SELECT array_agg(id ORDER BY origin, score DESC, "postedAt" DESC, "firstSeenAt" DESC, id)
        FROM (SELECT * FROM matched ORDER BY origin, score DESC, "postedAt" DESC, "firstSeenAt" DESC, id LIMIT ${limit}) p) AS ids`);
  return { ids: rows[0].ids ?? [], total: rows[0].total, elapsedMs: performance.now() - started };
}
const FIELD = { role: 'roles', family: 'families', sector: 'sectors', company: 'companyKeys', text: 'title' };
function elasticClause(c: SearchClause) {
  const fields = c.kind === 'company' ? ['title^10', 'company^5']
    : ['role', 'family'].includes(c.kind) ? ['title^10', 'duties^1'] : ['title^10', 'company^5', 'body^0.5'];
  const lexical: Record<string, unknown>[] = c.phrases.map(query => ({ multi_match: {
    query, fields: c.titleOnlyPhrases?.includes(query) ? ['title^10'] : fields, type: 'phrase',
  } }));
  const should: Record<string, unknown>[] = c.kind === 'role' ? [{bool:{must:[{bool:{should:lexical,minimum_should_match:1}}],must_not:[{exists:{field:'titleRoles'}}]}}] : lexical;
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
