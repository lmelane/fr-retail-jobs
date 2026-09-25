import { afterEach, expect, test, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const fixture = vi.hoisted(() => ({ release: null as { gitSha: string } | null }));
vi.mock('@catwalks/runtime', () => ({ get release() { return fixture.release; } }));
import { captureReaderRevision, deployedCommitHash } from './revision.js';

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
  expect(() => deployedCommitHash()).toThrow('differs from the embedded release');
});

/**
 * D-453 : trois écrivains du journal DataCorrection lisaient RAILWAY_GIT_COMMIT_SHA, absent des images du
 * registre, et écrivaient LOCAL_WORKTREE en production. Le SHA d'exécution se lit en UN seul endroit.
 */
test('no runtime code reads the platform Git SHA outside the attested revision', () => {
  vi.stubEnv('RAILWAY_GIT_COMMIT_SHA', undefined);
  fixture.release = { gitSha: 'c'.repeat(40) };
  expect(deployedCommitHash()).toBe('c'.repeat(40));
  const src = fileURLToPath(new URL('../', import.meta.url));
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(dir, entry.name)) : /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [join(dir, entry.name)] : []);
  const readers = files(src).filter(path => /RAILWAY_GIT_COMMIT_SHA/.test(readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
    .map(path => relative(src, path)).sort();
  // PipelineRun (observability/runtime.ts) already reads the embedded release first; revision.ts is the one reader.
  expect(readers).toEqual(['capture/revision.ts', 'observability/runtime.ts']);
  expect(readFileSync(join(src, 'observability/runtime.ts'), 'utf8')).toContain('release?.gitSha ?? process.env.RAILWAY_GIT_COMMIT_SHA');
});
