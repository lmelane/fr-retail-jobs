import { afterEach, expect, it, vi } from 'vitest';
import { maintainSourceAccess, qualifySourceAccess } from '../connectors/sourceAccessQualification.js';
import { pipelinePaused, assertPipelineRunning } from './pipelinePause.js';
import { captureExtraction } from '../capture/batch.js';
import { captureSourceEvidence } from '../capture/sourceEvidence.js';
import { fetchAtsJobs } from '../ats/index.js';
import { runIngest } from '../pipeline/ingest.js';
import { ingestAllBySource } from '../pipeline/ingestOrchestrator.js';
import { runRefresh } from '../pipeline/refresh.js';
import { fetchFollowingSafely } from './http.js';
import { fetchRenderedHtml } from './browser.js';
import { runGeocode } from '../pipeline/geocodeJobs.js';
import { consommerFlux, fluxHttp } from '../direct/feed.js';
import type { PrismaClient } from '@prisma/client';
afterEach(() => vi.unstubAllEnvs());
it('refuses invalid pause values instead of silently resuming', () => {
  expect(pipelinePaused({})).toBe(false); expect(pipelinePaused({ PIPELINE_PAUSED: '0' })).toBe(false);
  expect(pipelinePaused({ PIPELINE_PAUSED: '1' })).toBe(true);
  for (const value of ['', 'false', 'true', ' 1']) expect(() => pipelinePaused({ PIPELINE_PAUSED: value })).toThrow();
});
it('blocks imported collection functions before touching DB, adapter, HTTP or browser', async () => {
  vi.stubEnv('PIPELINE_PAUSED', '1');
  const touched = vi.fn(() => { throw new Error('Side effect attempted'); });
  const db = new Proxy({}, { get: touched }) as PrismaClient;
  expect(assertPipelineRunning).toThrow('PIPELINE_PAUSED');
  for (const call of [
    () => captureExtraction(db, 'witness', {}, undefined, touched),
    () => captureSourceEvidence(db, 'witness', { revisionId: 'test', purpose: 'SOURCE_IDENTITY', url: 'https://example.com', deadlineMs: 1000 }),
    () => fetchAtsJobs('TEAMTAILOR', { origin: 'https://example.com' }),
    () => runGeocode(db), () => consommerFlux(db, { lire: touched }),
    () => fluxHttp('https://example.com', 'unused', touched).lire(0n, 10),
    () => maintainSourceAccess(db, 'witness', 1000),
    () => qualifySourceAccess(db, { key: 'witness', kind: 'ashby' }, 'revision', 'batch', 'test'),
    () => runIngest(db), () => ingestAllBySource(db), () => runRefresh(db),
    () => fetchFollowingSafely('https://example.com', {}, new AbortController().signal),
    () => fetchRenderedHtml('https://example.com'),
  ]) await expect(call()).rejects.toThrow('PIPELINE_PAUSED');
  expect(touched).not.toHaveBeenCalled();
});
