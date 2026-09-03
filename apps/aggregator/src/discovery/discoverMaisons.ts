import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';
import { discoverAts, inspectCareerPage } from '../ats/detect.js';
import { fetchFashionJobsCompanies } from '../connectors/fashionjobs/companyDirectory.js';
import { loadSourceCatalog, sourceKeyFor } from '../connectors/sourceCatalog.js';
import { resolveCompany } from '../normalize/company.js';
import type { AtsDetection } from '../types.js';

/**
 * ATS discovery over a directory of Maisons (decision, 2026-09-02).
 *
 * The insight (Loïc): a jobboard's real value is its LIST of employers, not its
 * offers — an offer republished on FashionJobs (flow B) exists on the employer's
 * own ATS (flow A), where it is canonical, complete and carries a working apply
 * link. So this reads the FashionJobs directory (668 Maisons) purely as a roster,
 * runs ATS detection on each, and writes the confirmed sources to a REVIEW file
 * — never straight into sources.csv. A human validates the batch before it feeds
 * the pipeline, because a wrong source pollutes the catalogue at scale.
 *
 * Skips Maisons we already ingest (matched by resolved company key), so a run
 * only surfaces NEW coverage.
 */

/** AtsType (WORKDAY) -> the catalogue's kind string (workday). */
const KIND_FOR_TYPE: Record<string, string> = {
  WORKDAY: 'workday',
  GREENHOUSE: 'greenhouse',
  LEVER: 'lever',
  SMARTRECRUITERS: 'smartrecruiters-whitelabel',
  RECRUITEE: 'recruitee',
  PERSONIO: 'personio',
  TEAMTAILOR: 'teamtailor',
  EIGHTFOLD: 'eightfold',
  GENERIC_JSONLD: 'generic-listing',
};

export type DiscoveryRow = {
  maison: string;
  kind: string;
  detection: AtsDetection;
  offerCount?: number;
};

const OUT_PATH = fileURLToPath(new URL('../../data/sources.discovered.csv', import.meta.url));

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** One catalogue row from a detection, in the exact sources.csv column order. */
function toCsvLine(row: DiscoveryRow): string {
  const origin = (row.detection.config.origin as string) ?? row.detection.careersUrl;
  const domain = (() => {
    try {
      return new URL(row.detection.careersUrl).hostname;
    } catch {
      return '';
    }
  })();
  return [
    csvCell(row.maison),
    csvCell(domain),
    csvCell(row.kind),
    csvCell(JSON.stringify(row.detection.config)),
    csvCell(''), // job_url_pattern — left for a human to fill if needed
    csvCell(row.detection.note ?? `discovered, confidence ${row.detection.confidence}`),
    csvCell(String(row.offerCount ?? '')),
    csvCell('no'), // verified — a human flips this after checking the batch
  ].join(',');
}

/** A Maison to resolve: a name, and optionally the career/ATS URL we were given. */
type RosterEntry = { name: string; url?: string; slug?: string; offerCount?: number };

/** Parse a `nom,url` CSV (header optional). Tolerates quotes and extra columns. */
function parseRosterCsv(text: string): RosterEntry[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: RosterEntry[] = [];
  for (const line of lines) {
    // name,url — split on the FIRST comma only, so a URL with commas survives.
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const name = line.slice(0, comma).replace(/^"|"$/g, '').trim();
    const url = line.slice(comma + 1).replace(/^"|"$/g, '').trim();
    if (!name || name.toLowerCase() === 'nom' || name.toLowerCase() === 'maison') continue; // header
    rows.push({ name, url: url || undefined });
  }
  return rows;
}

export async function discoverMaisons(options?: {
  /** Cap the number of Maisons probed (a cheap first pass); 0 = all. */
  limit?: number;
  /** Parallel detections. Keep low — each may hit a live site. */
  concurrency?: number;
  /** A `nom,url` CSV to resolve from given URLs, instead of the FashionJobs directory. */
  inputFile?: string;
}): Promise<{ discovered: DiscoveryRow[]; skipped: number; unresolved: number; outPath: string }> {
  const limitCount = options?.limit ?? 0;
  const concurrency = options?.concurrency ?? 4;

  // Maisons we already ingest, by resolved company key — so discovery only
  // surfaces NEW employers, not the 101 sources already live.
  const known = new Set(loadSourceCatalog().map((s) => resolveCompany(s.maison).companyId));

  // Roster source: a provided `nom,url` file (preferred — no guessing), else the
  // FashionJobs directory read as a roster.
  let roster: RosterEntry[];
  if (options?.inputFile) {
    roster = parseRosterCsv(readFileSync(options.inputFile, 'utf8'));
  } else {
    const directory = await fetchFashionJobsCompanies();
    roster = directory.map((c) => ({ name: c.name, slug: c.fashionjobsSlug, offerCount: c.offerCount }));
  }

  const totalIn = roster.length;
  roster = (limitCount > 0 ? roster.slice(0, limitCount) : roster).filter(
    (c) => !known.has(resolveCompany(c.name).companyId),
  );

  const limit = pLimit(concurrency);
  const discovered: DiscoveryRow[] = [];
  let unresolved = 0;

  await Promise.all(
    roster.map((company) =>
      limit(async () => {
        try {
          // With a URL, inspect it directly (reliable). Without, fall back to the
          // free slug-probe + search path.
          const detection = company.url
            ? await inspectCareerPage(company.url)
            : await discoverAts(company.name, company.slug);
          if (!detection) {
            unresolved++;
            return;
          }
          const kind = KIND_FOR_TYPE[detection.type] ?? detection.type.toLowerCase();
          discovered.push({ maison: company.name, kind, detection, offerCount: company.offerCount });
        } catch {
          unresolved++;
        }
      }),
    ),
  );

  discovered.sort((a, b) => (b.offerCount ?? 0) - (a.offerCount ?? 0));

  const header = 'maison,careers_domain,kind,entry_url,job_url_pattern,robots_verdict,job_count,verified';
  writeFileSync(OUT_PATH, [header, ...discovered.map(toCsvLine)].join('\n') + '\n', 'utf8');

  return {
    discovered,
    skipped: totalIn - roster.length,
    unresolved,
    outPath: OUT_PATH,
  };
}
