import { afterEach, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { submitToGoogleIndex } from './googleIndexing.js';
import { installLogger, OperationalLogger, type LogRecord } from '../observability/logger.js';

afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  installLogger(new OperationalLogger({ runId: 'local-test' }));
});
it('retains each transport exception beyond the third failed indexing URL', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  vi.stubEnv('GOOGLE_INDEXING_CREDENTIALS', JSON.stringify({ client_email: 'unit@example.invalid', private_key: privateKey.export({ format: 'pem', type: 'pkcs8' }) }));
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'unit-test-token' }))).mockRejectedValue(new Error('transport unavailable'));
  vi.stubGlobal('fetch', fetchMock);
  const records: LogRecord[] = [];
  installLogger(new OperationalLogger({ runId: 'indexing-unit', persist: async record => { records.push(record); }, write: async () => {}, delay: async () => {} }));
  const result = await submitToGoogleIndex(Array.from({ length: 5 }, (_, i) => ({ url: `https://example.invalid/job/${i}`, type: 'URL_UPDATED' as const })));
  expect(result.failed).toBe(5);
  const errors = records.filter(r => r.event === 'indexing.url_failed');
  expect(errors).toHaveLength(5);
  expect(errors.every(r => (r.payload.error as any).message === 'transport unavailable')).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(6);
});
