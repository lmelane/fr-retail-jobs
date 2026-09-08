import { Prisma, type PrismaClient } from '@prisma/client';

/** Operational exposure, not a weighted score that could hide a critical defect. */
export async function buildHealthReport(prisma: PrismaClient, asOf = new Date(), freshnessHours = 48) {
  if (!Number.isFinite(freshnessHours) || freshnessHours <= 0) throw new Error('Invalid freshness window');
  const cutoff = new Date(asOf.getTime() - freshnessHours * 3_600_000);
  const base = Prisma.sql`
    WITH footprint AS (
      SELECT js."jobId", bool_or(js."lastSeenAt" >= ${cutoff}) AS fresh,
        count(DISTINCT js."sourceKey") AS sources,
        bool_or(js.url = j.url) AS "urlBacked"
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId" AND j."isActive"
      WHERE js."isActive" GROUP BY js."jobId"
    ), exposure AS (
      SELECT j.id, coalesce(f.fresh, false) AS fresh, coalesce(f.sources, 0) AS sources,
        coalesce(f."urlBacked", false) AS "urlBacked",
        coalesce(j."validThrough" < ${asOf}, false) AS expired,
        (NOT coalesce(f.fresh, false) OR NOT coalesce(f."urlBacked", false)
          OR coalesce(j."validThrough" < ${asOf}, false)) AS risk
      FROM "Job" j LEFT JOIN footprint f ON f."jobId" = j.id WHERE j."isActive"
    )`;
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [totals] = await tx.$queryRaw<Array<{
      activeJobs: number; atRiskJobs: number; withoutFreshSource: number;
      withoutActiveSource: number; expiredStillActive: number; canonicalUrlUnbacked: number;
    }>>(Prisma.sql`${base}
      SELECT count(*)::int AS "activeJobs", count(*) FILTER (WHERE risk)::int AS "atRiskJobs",
        count(*) FILTER (WHERE NOT fresh)::int AS "withoutFreshSource",
        count(*) FILTER (WHERE sources = 0)::int AS "withoutActiveSource",
        count(*) FILTER (WHERE expired)::int AS "expiredStillActive",
        count(*) FILTER (WHERE NOT "urlBacked")::int AS "canonicalUrlUnbacked" FROM exposure`);
    const sources = await tx.$queryRaw<Array<{
      sourceKey: string; activeJobs: number; atRiskJobs: number; exclusivelyBackedJobs: number;
      stalePostings: number; lastStatus: string | null; lastRunAt: Date | null;
      canAttestAbsence: boolean | null; complete: boolean | null; fetched: number | null; accepted: number | null;
      declaredTotal: number | null; truncated: boolean | null; errors: number | null;
      descriptionRate: number | null; countryRate: number | null; dateRate: number | null; urlRate: number | null;
    }>>(Prisma.sql`${base}, latest AS (
      SELECT DISTINCT ON ("sourceKey") * FROM "SourceRun"
      ORDER BY "sourceKey", "ranAt" DESC, id DESC
    ), keys AS (
      SELECT key AS "sourceKey" FROM "Source" WHERE status = 'ACTIVE'
      UNION SELECT DISTINCT js."sourceKey" FROM "JobSource" js JOIN exposure e ON e.id = js."jobId" WHERE js."isActive"
    ), counts AS (
      SELECT js."sourceKey", count(DISTINCT e.id)::int AS "activeJobs",
        count(DISTINCT e.id) FILTER (WHERE e.risk)::int AS "atRiskJobs",
        count(DISTINCT e.id) FILTER (WHERE e.sources = 1)::int AS "exclusivelyBackedJobs",
        count(*) FILTER (WHERE js."lastSeenAt" < ${cutoff})::int AS "stalePostings"
      FROM "JobSource" js JOIN exposure e ON e.id = js."jobId" WHERE js."isActive" GROUP BY js."sourceKey"
    ) SELECT k."sourceKey", coalesce(c."activeJobs", 0) AS "activeJobs",
      coalesce(c."atRiskJobs", 0) AS "atRiskJobs", coalesce(c."exclusivelyBackedJobs", 0) AS "exclusivelyBackedJobs",
      coalesce(c."stalePostings", 0) AS "stalePostings", l.status AS "lastStatus", l."ranAt" AS "lastRunAt",
      l."canAttestAbsence", l.complete, l.fetched, l.accepted, l."declaredTotal", l.truncated, l.errors,
      CASE WHEN l.accepted IS NOT NULL THEN l."descriptionRate" END AS "descriptionRate",
      CASE WHEN l.accepted IS NOT NULL THEN l."countryRate" END AS "countryRate",
      CASE WHEN l.accepted IS NOT NULL THEN l."dateRate" END AS "dateRate",
      CASE WHEN l.accepted IS NOT NULL THEN l."urlRate" END AS "urlRate"
    FROM keys k LEFT JOIN counts c USING ("sourceKey") LEFT JOIN latest l USING ("sourceKey")
    ORDER BY "atRiskJobs" DESC, "exclusivelyBackedJobs" DESC, k."sourceKey"`);
    return {
      schemaVersion: 1, asOf: asOf.toISOString(), freshnessHours, totals, sources,
      definitions: {
        atRiskJobs: 'Distinct active jobs with no fresh active source, no active source backing the canonical URL, or a known elapsed validThrough.',
        alternateSources: 'A fresh alternate source protects a job from freshness risk even if another source is stale.',
        aggregation: 'Per-source exposures overlap; never sum them to obtain the global total.',
        unknown: 'Null means unmeasured. Field presence rates do not establish field correctness.',
      },
      notYetMeasured: ['field-level contradictions', 'country ambiguity inventory', 'validated field completeness',
        'adapter drift against versioned fixtures', 'worldwide employer coverage against a reference universe'],
    };
  }, { isolationLevel: 'RepeatableRead', timeout: 30_000 });
}
