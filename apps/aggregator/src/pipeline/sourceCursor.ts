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

/** Which sources rotate, and how many listing pages each run covers. */
export const ROTATING_SOURCES: Record<string, { windowPages: number }> = {
  // FashionJobs: ~282 listing pages behind Cloudflare, ~27 offers each. 40 pages
  // a run covers the whole board in ~7 runs — a few hours given the cron cadence.
  fashionjobs: { windowPages: 40 },
};

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
): Promise<number> {
  const windowPages = ROTATING_SOURCES[sourceKey]?.windowPages ?? 40;
  const nextPage = reachedEnd ? 1 : startPage + windowPages;
  await prisma.sourceCursor.upsert({
    where: { sourceKey },
    create: { sourceKey, nextPage },
    update: { nextPage },
  });
  return nextPage;
}
