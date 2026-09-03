import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';
import { fetchAtsJobs } from '../ats/index.js';
import { normalizeSourceConfig } from '../connectors/sourceConfig.js';
import type { NormalizedJob } from '../types.js';

/**
 * Proves every catalogue row before an ingest trusts it.
 *
 * The catalogue is assembled from eight independent discovery batches, and each
 * agent wrote its own config shape: one WTTJ row says `slug`, another says
 * `org_slug`; Workable rows say `account` or `account_slug`. A key an adapter
 * does not recognise does not raise — it fetches nothing and returns an empty
 * array, which is indistinguishable from an employer with no openings. That is
 * exactly the silent failure that put false NONE verdicts in three batches.
 *
 * So: call each source for real, keep the ones that return jobs, and write the
 * rest to a rejects file WITH the reason. A source is in the catalogue because
 * it was seen working, not because a CSV claims it exists.
 */

const CSV_PATH = fileURLToPath(new URL('../../data/sources.csv', import.meta.url));
const OUT_PATH = fileURLToPath(new URL('../../data/sources.validated.csv', import.meta.url));
const REJECTS_PATH = fileURLToPath(new URL('../../data/sources.rejected.csv', import.meta.url));

/** kind (as written in the catalogue) -> the AtsType the dispatcher knows. */
export const ATS_TYPE: Record<string, string> = {
  successfactors: 'SUCCESSFACTORS',
  avature: 'AVATURE',
  eightfold: 'EIGHTFOLD',
  wttj: 'WTTJ',
  workday: 'WORKDAY',
  magnet: 'MAGNET',
  teamtailor: 'TEAMTAILOR',
  'smartrecruiters-whitelabel': 'SMARTRECRUITERS',
  workable: 'WORKABLE',
  talentview: 'TALENTVIEW',
  phenom: 'PHENOM',
  recruitee: 'RECRUITEE',
  lvmh_algolia: 'LVMH_ALGOLIA',
  ashby: 'ASHBY',
  lever: 'LEVER',
  pinpoint: 'PINPOINT',
  greenhouse: 'GREENHOUSE',
  gestmax: 'GENERIC_JSONLD',
  radancy: 'GENERIC_JSONLD',
  digitalrecruiters: 'DIGITALRECRUITERS',
  talentsoft: 'TALENTSOFT',
  personio: 'PERSONIO',
};

type Row = { maison: string; kind: string; config: Record<string, unknown>; declared: number };

function parseCsv(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split('\n').slice(1)) {
    if (!line.trim()) continue;
    // The config column is JSON and contains commas, so split on quoted fields.
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

    const [maison, , kind, configJson, , , declared] = fields;
    if (!maison || !kind) continue;
    try {
      rows.push({
        maison,
        kind,
        config: JSON.parse(configJson || '{}'),
        declared: Number(declared) || 0,
      });
    } catch {
      rows.push({ maison, kind, config: {}, declared: Number(declared) || 0 });
    }
  }
  return rows;
}

export type ValidationResult = {
  row: Row;
  jobs: number;
  withDescription: number;
  error?: string;
};

async function validateOne(row: Row): Promise<ValidationResult> {
  const type = ATS_TYPE[row.kind];
  if (!type) return { row, jobs: 0, withDescription: 0, error: `no adapter for kind "${row.kind}"` };

  try {
    const { jobs } = await fetchAtsJobs(type as never, normalizeSourceConfig(row.config));
    return {
      row,
      jobs: jobs.length,
      withDescription: jobs.filter((job) => (job.description?.length ?? 0) > 200).length,
      error: jobs.length === 0 ? 'returned 0 jobs' : undefined,
    };
  } catch (error) {
    return {
      row,
      jobs: 0,
      withDescription: 0,
      error: error instanceof Error ? error.message.slice(0, 140) : String(error),
    };
  }
}

export async function validateSources(): Promise<void> {
  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  console.log(`validating ${rows.length} sources…`);

  const limit = pLimit(Number(process.env.VALIDATE_CONCURRENCY ?? 6));
  let done = 0;

  const results = await Promise.all(
    rows.map((row) =>
      limit(async () => {
        const result = await validateOne(row);
        done++;
        const status = result.error ? `FAIL ${result.error}` : `${result.jobs} jobs`;
        console.log(`[${done}/${rows.length}] ${result.row.maison} (${result.row.kind}): ${status}`);
        return result;
      }),
    ),
  );

  const passed = results.filter((result) => !result.error);
  const failed = results.filter((result) => result.error);

  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;

  writeFileSync(
    OUT_PATH,
    'maison,kind,config_json,jobs,with_description\n' +
      passed
        .map((r) =>
          [
            escape(r.row.maison),
            r.row.kind,
            escape(JSON.stringify(normalizeSourceConfig(r.row.config))),
            r.jobs,
            r.withDescription,
          ].join(','),
        )
        .join('\n'),
  );

  writeFileSync(
    REJECTS_PATH,
    'maison,kind,declared_jobs,reason\n' +
      failed
        .map((r) => [escape(r.row.maison), r.row.kind, r.row.declared, escape(r.error ?? '')].join(','))
        .join('\n'),
  );

  const total = passed.reduce((sum, r) => sum + r.jobs, 0);
  console.log(`\n${passed.length} sources OK, ${total} jobs`);
  console.log(`${failed.length} rejected -> data/sources.rejected.csv`);
}
