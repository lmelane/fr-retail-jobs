import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { nextPageFor, advanceCursor, isRotatingSource } from './sourceCursor.js';

/**
 * The rotating-crawl cursor: a large, slow source advances through its listing
 * across runs and wraps back to page 1 at the end, so every offer is re-seen
 * within the lifecycle window.
 */
const prisma = new PrismaClient();

beforeEach(() => prisma.sourceCursor.deleteMany({}));
afterAll(async () => {
  await prisma.sourceCursor.deleteMany({});
  await prisma.$disconnect();
});

describe('isRotatingSource', () => {
  it('marks FashionJobs as rotating and an ordinary source as not', () => {
    expect(isRotatingSource('fashionjobs')).toBe(true);
    expect(isRotatingSource('hermes')).toBe(false);
  });
});

describe('the crawl cursor', () => {
  it('starts at page 1 for a source that has never run', async () => {
    expect(await nextPageFor(prisma, 'fashionjobs')).toBe(1);
  });

  it('advances by the window each run while there are more pages', async () => {
    const afterRun1 = await advanceCursor(prisma, 'fashionjobs', 1, false);
    expect(afterRun1).toBe(41); // window = 40
    expect(await nextPageFor(prisma, 'fashionjobs')).toBe(41);

    const afterRun2 = await advanceCursor(prisma, 'fashionjobs', 41, false);
    expect(afterRun2).toBe(81);
  });

  it('wraps back to page 1 when the board ends', async () => {
    await advanceCursor(prisma, 'fashionjobs', 241, false); // → 281
    const wrapped = await advanceCursor(prisma, 'fashionjobs', 281, true); // end reached
    expect(wrapped).toBe(1);
    expect(await nextPageFor(prisma, 'fashionjobs')).toBe(1);
  });

  it('keeps a separate cursor per source', async () => {
    await advanceCursor(prisma, 'fashionjobs', 1, false); // → 41
    await advanceCursor(prisma, 'other-board', 1, false); // → 41 independently
    expect(await nextPageFor(prisma, 'fashionjobs')).toBe(41);
    expect(await nextPageFor(prisma, 'other-board')).toBe(41);
  });
});
