import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pLimit from 'p-limit';
import { fetchAtsJobs } from '../ats/index.js';
import { normalizeSourceConfig } from '../connectors/sourceConfig.js';
import { ATS_TYPE } from '../pipeline/validateSources.js';
import { closeBrowser } from '../lib/browser.js';
import type { NormalizedJob } from '../types.js';

/**
 * Validates a stratified sample of data/sources.discovered.csv by calling each
 * adapter for real — the same proof validateSources applies to the main
 * catalogue, pointed at the discovery output before any row is promoted.
 *
 * Stratified because the discovered distribution is nothing like the old
 * catalogue's: Greenhouse+Teamtailor+Personio carry 65% of the rows while
 * Workday has 19. Validating 15 Greenhouse rows says more about coverage than
 * validating every Workday row would.
 *
 * Two failure classes matter, and the report shows evidence for both:
 *   - dead feed: adapter errors or returns 0 jobs;
 *   - WRONG COMPANY: a slug probe resolved "Alpha Industries" to the recruitee
 *     subdomain "alpha", which may belong to someone else entirely. No fetch
 *     can prove identity, so each row carries sample titles + a job URL for a
 *     human to eyeball against the maison.
 *
 * Usage: tsx src/discovery/validateDiscovered.ts [--all] [--kind=<kind>] [--seed=<n>]
 *   default: the stratified ~53-row sample below
 *   --all:   every discovered row whose kind has an adapter (J3 usage)
 *   --kind:  restrict to one kind (any quota, all rows of that kind)
 */

const CSV_PATH = fileURLToPath(new URL('../../data/sources.discovered.csv', import.meta.url));
const OUT_PATH = fileURLToPath(new URL('../../data/discovery.validation.tsv', import.meta.url));

/** Discovery kinds absent from the catalogue map. */
const EXTRA_KINDS: Record<string, string> = {
  'generic-listing': 'GENERIC_JSONLD',
};

/** Rows per kind in the default sample — proportional to the real distribution. */
const STRATA: Record<string, number> = {
  greenhouse: 15,
  teamtailor: 8,
  personio: 7,
  'generic-listing': 5,
  recruitee: 4,
  lever: 4,
  'smartrecruiters-whitelabel': 3,
  workday: 2,
  wttj: 2,
  successfactors: 1,
  digitalrecruiters: 1,
  eightfold: 1,
};

/**
 * A single source may hang on a slow renderer; the run must stay bounded.
 * Workday and Eightfold paginate large tenants slowly (J.Crew: 967 offers in
 * 153s) — a flat 120s falsely killed working sources.
 */
const PER_SOURCE_TIMEOUT_MS: Record<string, number> = {
  workday: 240_000,
  eightfold: 240_000,
  default: 120_000,
};

/** Errors worth one retry: the feed was fine seconds later (Lever, run of 2026-09-03). */
const TRANSIENT_ERROR = /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket|UND_ERR/i;

export type Row = {
  maison: string;
  careersDomain: string;
  kind: string;
  config: Record<string, unknown>;
  robotsVerdict: string;
};

/** Minimal RFC-4180 row parser: fields may be quoted and contain commas. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else current += char;
  }
  fields.push(current);
  return fields;
}

export function loadRows(csvPath: string = CSV_PATH): Row[] {
  const rows: Row[] = [];
  for (const line of readFileSync(csvPath, 'utf8').trim().split('\n').slice(1)) {
    if (!line.trim()) continue;
    const [maison, careersDomain, kind, configJson, , robotsVerdict] = parseCsvLine(line);
    if (!maison || !kind) continue;
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(configJson || '{}');
    } catch {
      config = {};
    }
    rows.push({ maison, careersDomain, kind, config, robotsVerdict: robotsVerdict ?? '' });
  }
  return rows;
}

/** Deterministic PRNG so a re-run validates the same sample. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(rows: Row[], seed: number): Row[] {
  const random = mulberry32(seed);
  const byKind = new Map<string, Row[]>();
  for (const row of rows) {
    byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
  }

  const picked: Row[] = [];
  for (const [kind, quota] of Object.entries(STRATA)) {
    const pool = [...(byKind.get(kind) ?? [])];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    picked.push(...pool.slice(0, quota));
  }
  return picked;
}

type Result = {
  row: Row;
  jobs: number;
  withDescription: number;
  /** Offers carrying a location — the C-03 bar is titre + URL + lieu. */
  withLocation: number;
  sampleTitles: string;
  sampleUrl: string;
  error?: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms / 1000}s (${label})`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function fetchWithOneRetry(type: string, row: Row): Promise<NormalizedJob[]> {
  const timeoutMs = PER_SOURCE_TIMEOUT_MS[row.kind] ?? PER_SOURCE_TIMEOUT_MS.default;
  const attempt = () =>
    withTimeout(
      fetchAtsJobs(type as never, normalizeSourceConfig(row.config)).then((r) => r.jobs),
      timeoutMs,
      row.maison,
    );
  try {
    return await attempt();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!TRANSIENT_ERROR.test(message)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    return attempt();
  }
}

async function validateOne(row: Row): Promise<Result> {
  const type = ATS_TYPE[row.kind] ?? EXTRA_KINDS[row.kind];
  if (!type) {
    return { row, jobs: 0, withDescription: 0, withLocation: 0, sampleTitles: '', sampleUrl: '', error: `no adapter for kind "${row.kind}"` };
  }

  try {
    const jobs: NormalizedJob[] = await fetchWithOneRetry(type, row);
    return {
      row,
      jobs: jobs.length,
      withDescription: jobs.filter((job) => (job.description?.length ?? 0) > 200).length,
      withLocation: jobs.filter((job) => Boolean(job.city || job.location || job.country)).length,
      sampleTitles: jobs.slice(0, 2).map((job) => job.title).join(' | '),
      sampleUrl: jobs[0]?.url ?? '',
      error: jobs.length === 0 ? 'returned 0 jobs' : undefined,
    };
  } catch (error) {
    return {
      row,
      jobs: 0,
      withDescription: 0,
      withLocation: 0,
      sampleTitles: '',
      sampleUrl: '',
      error: error instanceof Error ? error.message.slice(0, 160) : String(error),
    };
  }
}

async function main(): Promise<void> {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const all = process.argv.includes('--all');
  const onlyKind = arg('kind');
  const seed = Number(arg('seed') ?? 42);

  // Same DNS bypass as j3Probe: a long sweep at real concurrency starves the
  // macOS resolver and poisons its negative cache — opt-in, never in prod.
  const { configureExternalDnsFromEnv } = await import('../lib/externalDns.js');
  configureExternalDnsFromEnv();

  // --input: validate another catalogue (the gated set) instead of the raw
  // discovery output; --out keeps its report separate.
  const inputPath = arg('input');
  const rows = loadRows(inputPath ? fileURLToPath(new URL(`../../${inputPath}`, import.meta.url)) : undefined);
  const excluded = new Set((arg('exclude') ?? '').split(',').filter(Boolean));
  const targets = (onlyKind
    ? rows.filter((row) => row.kind === onlyKind)
    : all
      ? rows.filter((row) => ATS_TYPE[row.kind] ?? EXTRA_KINDS[row.kind])
      : sample(rows, seed)
  ).filter((row) => !excluded.has(row.kind));

  console.log(`validating ${targets.length} of ${rows.length} discovered sources…`);

  const limit = pLimit(Number(process.env.VALIDATE_CONCURRENCY ?? 4));
  let done = 0;
  const results = await Promise.all(
    targets.map((row) =>
      limit(async () => {
        const result = await validateOne(row);
        done++;
        const status = result.error ? `FAIL ${result.error}` : `${result.jobs} jobs`;
        console.log(`[${done}/${targets.length}] ${row.maison} (${row.kind}): ${status}`);
        return result;
      }),
    ),
  );

  const clean = (value: string) => value.replace(/[\t\n\r]+/g, ' ');
  const outArg = arg('out');
  const outPath = outArg ? fileURLToPath(new URL(`../../${outArg}`, import.meta.url)) : OUT_PATH;
  writeFileSync(
    outPath,
    'maison\tkind\tjobs\twith_description\twith_location\tsample_titles\tsample_url\terror\n' +
      results
        .map((r) =>
          [
            clean(r.row.maison),
            r.row.kind,
            r.jobs,
            r.withDescription,
            r.withLocation,
            clean(r.sampleTitles),
            clean(r.sampleUrl),
            clean(r.error ?? ''),
          ].join('\t'),
        )
        .join('\n') +
      '\n',
  );

  const byKind = new Map<string, { ok: number; fail: number; jobs: number }>();
  for (const result of results) {
    const entry = byKind.get(result.row.kind) ?? { ok: 0, fail: 0, jobs: 0 };
    if (result.error) entry.fail++;
    else {
      entry.ok++;
      entry.jobs += result.jobs;
    }
    byKind.set(result.row.kind, entry);
  }
  console.log('\nkind\tok\tfail\tjobs');
  for (const [kind, entry] of [...byKind.entries()].sort((a, b) => b[1].jobs - a[1].jobs)) {
    console.log(`${kind}\t${entry.ok}\t${entry.fail}\t${entry.jobs}`);
  }
  console.log(`\nreport -> ${outArg ?? 'data/discovery.validation.tsv'}`);
}

// Run only when executed directly — gateDiscovered imports this module's helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } finally {
    await closeBrowser();
  }
}
