import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalCompanyKey } from '../lib/normalize.js';
import type { Sector } from './sector.js';

/**
 * The Maisons reference list — the backbone of sector filtering.
 *
 * Hand-written regexes recognised only 20.9% of the 713 verified houses: Alaïa,
 * Acne Studios, agnès b. and Alexander McQueen all slipped through. No pattern
 * list will ever hold the long tail of independent French houses, so the data
 * drives the filter rather than the other way round.
 *
 * data/maisons.csv is built from sources that were actually fetched — the LVMH
 * jobhub API, catwalks.io, the Fédération de la Haute Couture, the Comité Colbert,
 * the GFF façonniers directory and group brand pages — each row carrying its
 * origin and a confidence level.
 */

export type MaisonEntry = {
  name: string;
  slug: string;
  segment: Sector | 'SUPPLIER' | 'MEDIA_AGENCY' | 'RECRUITER';
  group?: string;
  source: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
};

const CSV_PATH = fileURLToPath(new URL('../../data/maisons.csv', import.meta.url));

/** Minimal RFC-4180 row parser: fields may be quoted and contain commas. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      // A doubled quote inside a quoted field is a literal quote.
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

let cache: MaisonEntry[] | null = null;

export function loadMaisons(): MaisonEntry[] {
  if (cache) return cache;

  // Split on \r?\n: the file ships CRLF, and a bare '\n' split would leave a
  // trailing '\r' on the last field of every non-final row (confidence -> "HIGH\r").
  const lines = readFileSync(CSV_PATH, 'utf8').trim().split(/\r?\n/);
  const entries: MaisonEntry[] = [];

  // Skip the header row.
  for (const line of lines.slice(1)) {
    const [name, slug, segment, group, source, confidence] = parseCsvLine(line);
    if (!name || !slug) continue;
    entries.push({
      name,
      slug,
      segment: segment as MaisonEntry['segment'],
      group: group || undefined,
      source,
      confidence: (confidence as MaisonEntry['confidence']) ?? 'LOW',
    });
  }

  cache = entries;
  return entries;
}

let index: Map<string, MaisonEntry> | null = null;

/** Lookup index keyed by canonical company key, so spellings collapse. */
function maisonIndex(): Map<string, MaisonEntry> {
  if (index) return index;
  index = new Map();
  for (const entry of loadMaisons()) {
    const key = canonicalCompanyKey(entry.name);
    // First write wins: HIGH-confidence rows are listed before the long tail.
    if (key && !index.has(key)) index.set(key, entry);
    const slugKey = canonicalCompanyKey(entry.slug.replace(/-/g, ' '));
    if (slugKey && !index.has(slugKey)) index.set(slugKey, entry);
  }
  return index;
}

/** Exact match on the reference list, or null when the employer is unknown. */
export function findMaison(companyName: string): MaisonEntry | null {
  return maisonIndex().get(canonicalCompanyKey(companyName)) ?? null;
}
