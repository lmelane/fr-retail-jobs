import type { PrismaClient } from '@prisma/client';

/**
 * The rotating-crawl cursor (see the SourceCursor model).
 *
 * A source too large to sweep in one run advances through its listing across
 * runs: each run starts from `nextPage`, reads a window, and stores where to
 * resume — wrapping back to page 1 once it has passed the last page. Because the
 * cron fires several times a day, a full rotation finishes inside the 48h
 * lifecycle window, so every offer is re-seen before it could be closed as
 * stale.
 */

/** Which sources rotate, how many pages a run covers, and how many exist. */
export const ROTATING_SOURCES: Record<string, { windowPages: number; totalPagesEstimate: number }> = {
  // FashionJobs : ~282 pages de liste derrière Cloudflare, ~27 offres chacune.
  // Cadence quotidienne (D36, 2026-09-06) : la fenêtre couvre TOUT le board en
  // un run (282 pages ≈ 18 min au rythme mesuré de 40 pages / 2,5 min), sinon
  // une rotation de 8 runs à 24 h = 12 jours, et le refresh (48 h) fermerait
  // des offres encore listées (invariant L-01, cadence.test.ts).
  fashionjobs: { windowPages: 300, totalPagesEstimate: 282 },
};

/**
 * Cadence gravée (D36, décision Loïc 2026-09-06, révise DEC-5) : un ingest
 * par jour, la nuit (03:00 Paris), refresh après, reconcile hebdomadaire.
 * « Une fois par jour max, pour détecter et nettoyer les offres périmées. »
 * Les crons restent gelés jusqu'au run global validé à 100 %.
 */
export const INGEST_INTERVAL_HOURS = 24;

/**
 * L-01 invariant: an offer must be RE-SEEN by its rotating crawl before the
 * refresh can count it stale. A full rotation takes ceil(pages/window) runs at
 * one run per ingest interval; ×1.5 absorbs a skipped or partial run. If
 * REFRESH_STALE_HOURS drops below this for any rotating source, the refresh
 * closes offers that are still listed — tested, so a cadence change that
 * breaks the invariant fails CI instead of silently emptying a source.
 */
export function requiredStaleHours(sourceKey: string, ingestIntervalHours = INGEST_INTERVAL_HOURS): number {
  const rotation = ROTATING_SOURCES[sourceKey];
  if (!rotation) return 0;
  const runsPerRotation = Math.ceil(rotation.totalPagesEstimate / rotation.windowPages);
  return runsPerRotation * ingestIntervalHours * 1.5;
}

export function isRotatingSource(sourceKey: string): boolean {
  return sourceKey in ROTATING_SOURCES;
}

/** The page the next run should start from (1 if the source has never run). */
export async function nextPageFor(prisma: PrismaClient, sourceKey: string): Promise<number> {
  const row = await prisma.sourceCursor.findUnique({ where: { sourceKey } });
  return row?.nextPage && row.nextPage > 0 ? row.nextPage : 1;
}

/**
 * Advance the cursor after a run.
 *
 * `reachedEnd` is true when the crawl ran out of listing pages before filling
 * its window (the natural end of the board) — the next run then wraps to page 1.
 * Otherwise it continues from where this run stopped.
 */
export async function advanceCursor(
  prisma: PrismaClient,
  sourceKey: string,
  startPage: number,
  reachedEnd: boolean,
  /** Last page the crawl actually finished (F-07); resumes right after it. */
  lastPageDone?: number,
): Promise<number> {
  const windowPages = ROTATING_SOURCES[sourceKey]?.windowPages ?? 40;
  // Resume where the crawl really stopped, not where the window would have
  // ended: a sweep cut at page 3 of 40 (Cloudflare, deadline) must re-cover
  // pages 4-40 next run, not skip them. No page done at all = retry the same
  // window.
  const nextPage = reachedEnd ? 1 : lastPageDone !== undefined ? lastPageDone + 1 : startPage;
  await prisma.sourceCursor.upsert({
    where: { sourceKey },
    create: { sourceKey, nextPage },
    update: { nextPage },
  });
  return nextPage;
}
