import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { captureExtraction, replayExtraction } from '../capture/batch.js';
import { compareExtractionResult } from '../capture/manifest.js';
import { sourceDeadlineReached, withSourceBudget } from '../lib/sourceBudget.js';
import { evidenceHash } from '../lib/evidenceHash.js';
import { fetchJson } from '../lib/http.js';

const db = new PrismaClient();
const url = 'https://budget.example.com/jobs';
const key = () => `budget-${randomUUID()}`;
const reader = async () => {
  if (sourceDeadlineReached()) return { jobs: [], complete: false, truncated: true };
  await fetchJson(url);
  return { jobs: [{ externalId: '1', title: 'Client Advisor', url, raw: { id: '1' } }], complete: true, truncated: false };
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => db.$disconnect());

describe('execution budget and capture configuration', () => {
  it('keeps one configuration hash across different operational budgets and records them separately', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ witness: key() }))));
    const keys = [key(), key()]; const config = { tenant: 'Maison' };
    for (const [index, timeoutMs] of [10000, 20000].entries()) {
      await withSourceBudget(() => captureExtraction(db, keys[index], config, undefined, reader), timeoutMs, keys[index], { softTimeoutMs: timeoutMs - 100 });
    }
    const batches = await db.captureBatch.findMany({ where: { sourceKey: { in: keys } } });
    expect(batches.map(batch => batch.configHash)).toEqual([evidenceHash(config), evidenceHash(config)]);
    expect(batches.every(batch => batch.executionBudget !== null)).toBe(true);
    expect(batches.map(batch => (batch.executionBudget as { timeoutMs: number }).timeoutMs).sort()).toEqual([10000, 20000]);
    await expect(db.captureBatch.update({ where: { id: batches[0].id }, data: { executionBudget: {} } })).rejects.toThrow('immutable');
  });

  it('passes the exact frozen configuration snapshot whose hash was recorded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ witness: key() }))));
    const config = { filters: { country: 'FR' } }; const sourceKey = key();
    const originalHash = evidenceHash(config);
    await captureExtraction(db, sourceKey, config, undefined, async settings => {
      config.filters.country = 'US';
      expect(settings).toEqual({ filters: { country: 'FR' } });
      expect(() => { (settings.filters as { country: string }).country = 'GB'; }).toThrow(TypeError);
      return reader();
    });
    expect((await db.captureBatch.findFirstOrThrow({ where: { sourceKey } })).configHash).toBe(originalHash);
  });

  it('replays every recorded page even after the caller soft deadline, while retaining its hard cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ witness: key() }))));
    const sourceKey = key();
    await withSourceBudget(() => captureExtraction(db, sourceKey, {}, undefined, reader), 1000, sourceKey, { softTimeoutMs: 900 });
    const batch = await db.captureBatch.findFirstOrThrow({ where: { sourceKey } });
    const network = vi.fn(async () => { throw new Error('Replay must stay offline'); }); vi.stubGlobal('fetch', network);
    const replayAttempt = withSourceBudget(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(sourceDeadlineReached()).toBe(true);
      return replayExtraction(db, batch.id, reader);
    }, 1000, 'offline-check', { softTimeoutMs: 1 });
    await expect(replayAttempt).resolves.toMatchObject({ complete: true });
    const replayed = await replayAttempt;
    expect((await compareExtractionResult(db, batch.id, replayed)).exact).toBe(true);
    expect(network).not.toHaveBeenCalled();
    await expect(withSourceBudget(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return replayExtraction(db, batch.id, reader);
    }, 1, 'expired-replay')).rejects.toThrow('__TIMEOUT__ expired-replay');
  });
});
