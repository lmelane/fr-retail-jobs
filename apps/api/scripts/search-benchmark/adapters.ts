import { Prisma, prisma } from '@catwalks/db';
import { searchSql } from '../../lib/search-sql';
import { type SearchIntent } from '../../lib/search-intent';
import { elasticQuery } from './elastic-query';
import profile from './elastic-profile.json';
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
export async function elasticsearch(intent: SearchIntent, countries: readonly string[], limit: number): Promise<EngineResult> {
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:59200/${profile.index}/_search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify(elasticQuery(intent, countries, limit)),
  });
  if (!response.ok) throw new Error(`Elasticsearch ${response.status}: ${await response.text()}`);
  const result = await response.json();
  return { ids: result.hits.hits.map((h: { _id: string }) => h._id), total: result.hits.total.value, elapsedMs: performance.now() - started };
}
