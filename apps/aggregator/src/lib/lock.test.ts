import '../test/setup-integration.js';
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { tryAcquireIngestLock, releaseIngestLock } from './lock.js';

/**
 * The ingest lock stops two runs from overlapping. Advisory locks are per
 * connection, so a second CLIENT (a second ingest process) must fail to take
 * the lock while the first holds it.
 */

const a = new PrismaClient();
const b = new PrismaClient();

afterAll(async () => {
  await releaseIngestLock(a).catch(() => {});
  await releaseIngestLock(b).catch(() => {});
  await a.$disconnect();
  await b.$disconnect();
});

describe('ingest lock', () => {
  it('lets the first run take it and blocks a concurrent run', async () => {
    expect(await tryAcquireIngestLock(a)).toBe(true);
    // A different connection (a second ingest process) cannot take it now.
    expect(await tryAcquireIngestLock(b)).toBe(false);
    // Once the first releases, the second can take it.
    await releaseIngestLock(a);
    expect(await tryAcquireIngestLock(b)).toBe(true);
    await releaseIngestLock(b);
  });
});
