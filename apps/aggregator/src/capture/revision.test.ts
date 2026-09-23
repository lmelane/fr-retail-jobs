import { afterEach, expect, test, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ release: null as { gitSha: string } | null }));
vi.mock('@catwalks/runtime', () => ({ get release() { return fixture.release; } }));
import { captureReaderRevision } from './revision.js';

afterEach(() => { fixture.release = null; vi.unstubAllEnvs(); });
test('an image without a Git-connected service uses its sealed reader revision', () => {
  vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', undefined);
  fixture.release = { gitSha: 'a'.repeat(40) };
  expect(captureReaderRevision()).toBe(`git:${'a'.repeat(40)}`);
});
test('a platform Git revision cannot replace the embedded reader', () => {
  fixture.release = { gitSha: 'a'.repeat(40) };
  vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', 'b'.repeat(40));
  expect(() => captureReaderRevision()).toThrow('differs from the embedded release');
});
