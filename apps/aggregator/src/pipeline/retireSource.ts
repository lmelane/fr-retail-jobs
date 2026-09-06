import type { PrismaClient } from '@prisma/client';

/**
 * Retires a source that left the catalogue (decision Loïc, 2026-09-03).
 *
 * Deleting a catalogue line has no lifecycle of its own: the rows it wrote
 * stay in base forever — the generation purge never touches them (the source
 * no longer runs, so nothing re-stamps or purges its rows) and the refresh
 * merely closes them after 48 h, leaving inactive offers attributed to a
 * label like « Cartier +3 ». Seen live with the Richemont route removal
 * (A-01/R-01), and needed again every time a Flux B board is abandoned.
 *
 * What it does, per job that carries a JobSource of the retired key:
 *   - the JobSource rows of that key are deleted;
 *   - a job whose ONLY source was the retired one is deleted outright — no
 *     source vouches for it any more, and D1 forbids showing what nothing
 *     backs (Google already got its 410 if refresh closed it earlier);
 *   - a job that other sources still list survives untouched, and if the
 *     retired source owned its canonical URL, the best remaining source
 *     takes over.
 */

export type RetireStats = {
  sourceKey: string;
  jobSourcesRemoved: number;
  jobsDeleted: number;
  jobsKept: number;
  urlsReassigned: number;
};

const TIER_ORDER = ['EMPLOYER_DIRECT', 'GROUP_OFFICIAL', 'ATS_OFFICIAL', 'SPECIALIST_JOBBOARD', 'AGGREGATOR'];

export type RetireOptions = {
  /**
   * Ne retirer que les rattachements dont l'externalId commence par ce préfixe.
   *
   * Cas mesuré le 2026-09-06 : la clé `kering` portait DEUX routes — le flux
   * Eightfold (ids numériques, 1 033 offres, 99 % de description) et une route
   * sitemap du registre (ids = URL `https://www.kering.com/…`, 1 427 offres dont
   * 394 périmées, un stage de 2021 ré-attesté à chaque run). Retirer la clé
   * entière aurait supprimé le flux vivant ; le préfixe ne retire que la route
   * morte. Avec un préfixe, la ligne Source n'est PAS passée RETIRED.
   */
  externalIdPrefix?: string;
};

export async function retireSource(
  prisma: PrismaClient,
  sourceKey: string,
  options: RetireOptions = {},
): Promise<RetireStats> {
  const stats: RetireStats = { sourceKey, jobSourcesRemoved: 0, jobsDeleted: 0, jobsKept: 0, urlsReassigned: 0 };
  const prefix = options.externalIdPrefix;
  const matches = (s: { sourceKey: string; externalId: string }) =>
    s.sourceKey === sourceKey && (!prefix || s.externalId.startsWith(prefix));
  const sourceWhere = prefix ? { sourceKey, externalId: { startsWith: prefix } } : { sourceKey };

  // The catalogue row leaves the rotation first (DEC-3), so a concurrent ingest
  // cannot re-write rows while this pass detaches them. updateMany: a legacy
  // key with no Source row (pre-table flow B) still gets its data cleaned.
  if (!prefix) await prisma.source.updateMany({ where: { key: sourceKey }, data: { status: 'RETIRED' } });

  const affected = await prisma.job.findMany({
    where: { sources: { some: sourceWhere } },
    include: { sources: true },
  });

  for (const job of affected) {
    const retired = job.sources.filter(matches);
    const remaining = job.sources.filter((s) => !matches(s));

    await prisma.$transaction(async (tx) => {
      await tx.jobSource.deleteMany({ where: { jobId: job.id, ...sourceWhere } });
      stats.jobSourcesRemoved += retired.length;

      if (remaining.length === 0) {
        await tx.job.delete({ where: { id: job.id } });
        stats.jobsDeleted++;
        return;
      }

      stats.jobsKept++;
      // The retired source may have owned the canonical apply URL; hand it to
      // the best remaining source so the candidate never lands on a dead link.
      const ownedUrl = retired.some((s) => s.url === job.url);
      if (ownedUrl) {
        const best = [...remaining].sort(
          (a, b) => TIER_ORDER.indexOf(a.sourceTier) - TIER_ORDER.indexOf(b.sourceTier),
        )[0];
        await tx.job.update({
          where: { id: job.id },
          data: { url: best.url, canonicalTier: best.sourceTier },
        });
        stats.urlsReassigned++;
      }
    });
  }

  return stats;
}
