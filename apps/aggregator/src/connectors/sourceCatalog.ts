import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SourceTier } from '../dedup/match.js';

/**
 * The verified source catalogue, loaded from data/sources.csv.
 *
 * Kept as data rather than code because the list grows by discovery, not by
 * engineering: adding a house that runs Teamtailor or Phenom is a CSV row, and
 * only a genuinely new ATS needs an adapter.
 *
 * Every row was fetched live with a real job count and a quoted robots verdict.
 */

export type SourceKind =
  | 'teamtailor'
  | 'phenom'
  | 'digitalrecruiters'
  | 'workday'
  | 'greenhouse'
  | 'lever'
  | 'lever-eu'
  | 'smartrecruiters-whitelabel'
  | 'recruitee'
  | 'wttj'
  | 'gestmax'
  | 'talentview'
  | 'pinpoint'
  | 'eightfold'
  | 'wordpress-custom'
  | string;

export type CatalogSource = {
  maison: string;
  careersDomain: string;
  kind: SourceKind;
  entryUrl: string;
  /** Shape of a job URL, as observed. Empty when the source is an API. */
  jobUrlPattern: string;
  robotsVerdict: string;
  /** Jobs seen when the source was verified. */
  jobCount: number;
};

const CSV_PATH = fileURLToPath(new URL('../../data/sources.csv', import.meta.url));

/** Minimal RFC-4180 row parser: fields may be quoted and contain commas. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

let cache: CatalogSource[] | null = null;

export function loadSourceCatalog(): CatalogSource[] {
  if (cache) return cache;

  const lines = readFileSync(CSV_PATH, 'utf8').trim().split('\n');
  const sources: CatalogSource[] = [];

  for (const line of lines.slice(1)) {
    const [maison, careersDomain, kind, entryUrl, jobUrlPattern, robotsVerdict, jobCount] =
      parseCsvLine(line);
    if (!maison || !entryUrl) continue;
    sources.push({
      maison,
      careersDomain,
      kind,
      entryUrl,
      jobUrlPattern: jobUrlPattern ?? '',
      robotsVerdict: robotsVerdict ?? '',
      jobCount: Number(jobCount) || 0,
    });
  }

  cache = sources;
  return sources;
}

/**
 * Which ATS families answer through an API — one request per employer, with the
 * description included. Everything else falls back to sitemap + JSON-LD.
 */
const API_KINDS = new Set([
  'greenhouse',
  'lever',
  'lever-eu',
  'ashby',
  'workable',
  'recruitee',
  'personio',
  'workday',
  'wttj',
]);

export function isApiSource(source: CatalogSource): boolean {
  return API_KINDS.has(source.kind);
}

/** Tier for dedup: a jobboard never outranks an employer's own site. */
export function tierFor(source: CatalogSource): SourceTier {
  if (source.kind === 'wttj') return 'SPECIALIST_JOBBOARD';
  if (API_KINDS.has(source.kind)) return 'ATS_OFFICIAL';
  return 'EMPLOYER_DIRECT';
}

/** Stable key for JobSource rows: the maison, slugified. */
export function sourceKeyFor(source: CatalogSource): string {
  return source.maison
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
