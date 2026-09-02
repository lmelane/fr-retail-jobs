import type { PrismaClient } from '@prisma/client';

/**
 * A PostgreSQL advisory lock, so two ingest runs never overlap.
 *
 * On a 24h cron a slow run could still be going when the next is triggered (or a
 * redeploy restarts the container mid-run). Two ingests writing at once fight
 * over the same clusters and Company upserts. A session-level advisory lock lets
 * the second run detect the first and bow out cleanly instead of racing it.
 *
 * The lock is tied to the Prisma session; it releases when the connection
 * closes, so a crashed run never leaves it stuck.
 */

/** Stable 64-bit key for the ingest lock (arbitrary, project-specific). */
const INGEST_LOCK_KEY = 776_610_042;

/** Tries to take the ingest lock. Returns false if another run holds it. */
export async function tryAcquireIngestLock(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ locked: boolean }[]>(
    `SELECT pg_try_advisory_lock(${INGEST_LOCK_KEY}) AS locked`,
  );
  return rows[0]?.locked === true;
}

/** Releases the ingest lock. Safe to call even if it was not held. */
export async function releaseIngestLock(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock(${INGEST_LOCK_KEY})`);
}
