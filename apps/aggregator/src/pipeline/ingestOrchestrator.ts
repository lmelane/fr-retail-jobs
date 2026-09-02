import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { plainHttpSources } from '../connectors/registry.js';
import { loadSourceCatalog, sourceKeyFor } from '../connectors/sourceCatalog.js';
import { KIND_TO_ATS } from './ingest.js';

/**
 * Runs every source as its OWN short child process (decision D6).
 *
 * A single in-process run of all sources took 21 minutes and was killed by the
 * platform before it reached a single API feed — the reason production held a
 * handful of employers. Here each source is `ingest --source=<key>` in a fresh
 * child process with its own time budget, run in series. A source that hangs,
 * crashes or is killed takes ONLY its own child down; the orchestrator logs it
 * and moves to the next. No source can starve the others, whatever the volume.
 *
 * API feeds run first (cheap, the bulk of the market), sitemap sources last.
 */

/** Kill a single source's run after this long — a stuck feed must not block the rest. */
const PER_SOURCE_TIMEOUT_MS = Number(process.env.INGEST_SOURCE_TIMEOUT_MS ?? 8 * 60_000);

export type OrchestratorResult = {
  total: number;
  ok: number;
  failed: number;
  timedOut: number;
  failures: string[];
};

/** Every source key, API feeds first then sitemap sources. */
export function allSourceKeys(): string[] {
  const apiKeys = loadSourceCatalog()
    .filter((source) => KIND_TO_ATS[source.kind])
    .map((source) => sourceKeyFor(source));
  const sitemapKeys = plainHttpSources()
    .filter((source) => source.kind === 'SITEMAP_JSONLD')
    .map((source) => source.key);
  // De-dupe while preserving order (API first).
  return [...new Set([...apiKeys, ...sitemapKeys])];
}

/** Spawns `ingest --source=<key>` and resolves with its outcome. */
function runOneSource(key: string): Promise<'ok' | 'failed' | 'timedOut'> {
  return new Promise((resolve) => {
    const here = dirname(fileURLToPath(import.meta.url));
    const cliPath = join(here, '..', 'cli.ts');
    // tsx runs the TypeScript CLI directly, same entrypoint as `npm run ingest`.
    const child = spawn('npx', ['tsx', cliPath, 'ingest', `--source=${key}`], {
      stdio: 'inherit',
      env: process.env,
    });

    let settled = false;
    const done = (outcome: 'ok' | 'failed' | 'timedOut') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    const timer = setTimeout(() => {
      console.error(`[orchestrator] ${key}: timed out after ${PER_SOURCE_TIMEOUT_MS / 1000}s, killing`);
      child.kill('SIGKILL');
      done('timedOut');
    }, PER_SOURCE_TIMEOUT_MS);

    child.on('exit', (code) => done(code === 0 ? 'ok' : 'failed'));
    child.on('error', (error) => {
      console.error(`[orchestrator] ${key}: failed to spawn — ${error.message}`);
      done('failed');
    });
  });
}

export async function ingestAllBySource(): Promise<OrchestratorResult> {
  const keys = allSourceKeys();
  console.log(`[orchestrator] ${keys.length} sources, one child process each: ${keys.join(', ')}`);

  const result: OrchestratorResult = { total: keys.length, ok: 0, failed: 0, timedOut: 0, failures: [] };

  for (const key of keys) {
    const outcome = await runOneSource(key);
    if (outcome === 'ok') result.ok++;
    else {
      result[outcome === 'timedOut' ? 'timedOut' : 'failed']++;
      result.failures.push(`${key} (${outcome})`);
    }
  }

  console.log(
    `[orchestrator] done: ${result.ok}/${result.total} ok, ${result.failed} failed, ${result.timedOut} timed out` +
      (result.failures.length ? ` — ${result.failures.join(', ')}` : ''),
  );
  return result;
}
