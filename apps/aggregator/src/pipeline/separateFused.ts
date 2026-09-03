import type { PrismaClient } from '@prisma/client';
import { PIPELINE_VERSION } from './version.js';

/**
 * Repairs the damage of audit finding D-01: while the intra-source guard was
 * dead in the write path, several REAL openings of one source (three distinct
 * "Sales Associate" ids at the same boutique) were fused into one Job carrying
 * N JobSource rows of the SAME sourceKey with DIFFERENT externalIds.
 *
 * A job may legitimately carry several sources — but never twice the same
 * source under two ids. This pass splits every extra same-source JobSource back
 * into its own Job, seeded from the JobSource's own fields; the next ingest of
 * that source then refreshes the description and details through the normal
 * (sourceKey, externalId) match.
 *
 * The metric it prints — jobs still carrying ≥ 2 JobSource of one sourceKey —
 * is the direct indicator of the bug: it must read 0 after this pass, and stay
 * 0 forever once the write-path guard ships with it.
 */

export type SeparationStats = {
  /** Jobs found fused (≥ 2 sources of one sourceKey) before the pass. */
  fusedBefore: number;
  /** New Job rows created by splitting. */
  separated: number;
  /** Sources re-attached to an already-existing job (unique key existed). */
  reattached: number;
  /** Jobs still fused after the pass — MUST be zero. */
  fusedAfter: number;
};

async function countFused(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(DISTINCT "jobId") AS count FROM (
      SELECT "jobId" FROM "JobSource"
      GROUP BY "jobId", "sourceKey"
      HAVING COUNT(DISTINCT "externalId") > 1
    ) fused`;
  return Number(rows[0]?.count ?? 0);
}

export async function separateFusedJobs(prisma: PrismaClient): Promise<SeparationStats> {
  const fusedBefore = await countFused(prisma);
  let separated = 0;
  let reattached = 0;

  const fusedGroups = await prisma.$queryRaw<{ jobId: string; sourceKey: string }[]>`
    SELECT "jobId", "sourceKey" FROM "JobSource"
    GROUP BY "jobId", "sourceKey"
    HAVING COUNT(DISTINCT "externalId") > 1`;

  for (const { jobId, sourceKey } of fusedGroups) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, include: { sources: true } });
    if (!job) continue;

    const sameSource = job.sources
      .filter((s) => s.sourceKey === sourceKey)
      .sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
    // The job's own externalId marks the entry it was created from; keep that
    // one (or the oldest) attached, split every other id into its own Job.
    const keeper = sameSource.find((s) => s.externalId === job.externalId) ?? sameSource[0];

    for (const source of sameSource) {
      if (source.id === keeper.id) continue;

      await prisma.$transaction(async (tx) => {
        const existing = await tx.job.findUnique({
          where: {
            companyId_source_externalId: {
              companyId: job.companyId,
              source: job.source,
              externalId: source.externalId,
            },
          },
          select: { id: true },
        });

        if (existing) {
          await tx.jobSource.update({ where: { id: source.id }, data: { jobId: existing.id } });
          reattached++;
          return;
        }

        const created = await tx.job.create({
          data: {
            companyId: job.companyId,
            externalId: source.externalId,
            source: job.source,
            title: source.title ?? job.title,
            location: job.location,
            country: job.country,
            isFrance: job.isFrance,
            city: job.city,
            postalCode: job.postalCode,
            latitude: job.latitude,
            longitude: job.longitude,
            contract: job.contract,
            workingTime: job.workingTime,
            remote: job.remote,
            department: job.department,
            language: job.language,
            description: job.description,
            url: source.url,
            postedAt: source.postedAt ?? job.postedAt,
            clusterKey: job.clusterKey,
            canonicalTier: source.sourceTier,
            fingerprint: `${job.clusterKey}|${source.title ?? job.title}|${source.externalId}`,
            pipelineVersion: PIPELINE_VERSION,
            firstSeenAt: source.firstSeenAt,
            lastSeenAt: source.lastSeenAt,
            isActive: source.isActive,
            raw: source.raw ?? undefined,
          },
          select: { id: true },
        });
        await tx.jobSource.update({ where: { id: source.id }, data: { jobId: created.id } });
        separated++;
      });
    }
  }

  const fusedAfter = await countFused(prisma);
  return { fusedBefore, separated, reattached, fusedAfter };
}
