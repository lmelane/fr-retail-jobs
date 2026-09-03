import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pLimit from 'p-limit';
import { inspectCareerPage } from '../ats/detect.js';
import { probeAtsBySlug } from './atsProbe.js';
import { fetchRenderedHtml } from '../lib/browser.js';
import { loadSourceCatalog } from '../connectors/sourceCatalog.js';
import { resolveCompany } from '../normalize/company.js';
import type { AtsDetection } from '../types.js';

/**
 * ATS discovery over a roster of Maisons — A→Z, browser-based, resilient
 * (decision, 2026-09-02, Loïc).
 *
 * The insight: a jobboard's value is its LIST of employers, not its offers — an
 * offer republished on a board (flow B) exists on the employer's own ATS
 * (flow A), canonical and with a working apply link. So this takes a roster
 * (nom,url — a homepage is fine) and, per Maison:
 *   1. opens the page IN A BROWSER (JS-rendered: modern sites inject the careers
 *      link client-side, invisible to plain fetch — measured, near-zero hits),
 *   2. detects the ATS on it, else follows its careers link one hop and detects
 *      there,
 *   3. records the confirmed source for HUMAN REVIEW — never straight into
 *      sources.csv, because a wrong source pollutes the catalogue at scale.
 *
 * Resilience is the point at 14k+ rows:
 *   - RESUMABLE: every processed Maison is appended to a progress log; a re-run
 *     skips what is already done, so a crash/stop never loses work.
 *   - ISOLATED FAILURES: one Maison's timeout/error is caught and recorded as
 *     unresolved; it never aborts the batch.
 *   - POLITE + BOUNDED: small concurrency, a per-page timeout inside the browser
 *     transport, and results streamed to disk rather than held in memory.
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
};

type RosterEntry = { name: string; url?: string };

const dataUrl = (name: string) => fileURLToPath(new URL(`../../data/${name}`, import.meta.url));
const OUT_PATH = dataUrl('sources.discovered.csv');
/** One line per Maison already processed (name<TAB>status<TAB>kind), for resume. */
const PROGRESS_PATH = dataUrl('discovery.progress.tsv');
/** Maisons auto-discovery could NOT resolve — the queue for the manual pass. */
const UNRESOLVED_PATH = dataUrl('sources.unresolved.csv');
/**
 * Domains proven dead by the reachability sweep — each line carries its
 * evidence (cause, the resolvers that confirmed a DNS death: 1.1.1.1+8.8.8.8,
 * never the system resolver alone — see the poisoned-cache incident) and its
 * check date. Excluded from discovery runs (decision Loïc, 2026-09-03), but a
 * dead domain is not dead forever: past DEAD_RECHECK_DAYS the entry expires
 * and the Maison re-enters the queue, so a resurrected brand is found again
 * without anyone remembering to run anything.
 */
const DEAD_PATH = dataUrl('unresolved.dead.tsv');
const DEAD_RECHECK_DAYS = Number(process.env.DEAD_RECHECK_DAYS ?? 30);

export function loadDeadNames(now = new Date()): Set<string> {
  if (!existsSync(DEAD_PATH)) return new Set();
  const cutoff = now.getTime() - DEAD_RECHECK_DAYS * 86_400_000;
  const dead = new Set<string>();
  for (const line of readFileSync(DEAD_PATH, 'utf8').split(/\r?\n/).slice(1)) {
    const [name, , , , , checkedAt] = line.split('\t');
    if (!name) continue;
    // No date (legacy line) or a stale check: the verdict has expired.
    const checked = checkedAt ? Date.parse(checkedAt) : NaN;
    if (Number.isNaN(checked) || checked < cutoff) continue;
    dead.add(name.toLowerCase());
  }
  return dead;
}

function csvCell(value: string): string {
  // Defang spreadsheet formula injection: a company name starting with = + - @
  // would execute as a formula if a reviewer opens the CSV in Excel/Sheets.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Parse a `nom,url` CSV (header optional). Splits on the first comma only. */
function parseRosterCsv(text: string): RosterEntry[] {
  const rows: RosterEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const name = line.slice(0, comma).replace(/^"|"$/g, '').trim();
    const url = line.slice(comma + 1).replace(/^"|"$/g, '').trim();
    const lower = name.toLowerCase();
    if (!name || lower === 'nom' || lower === 'maison') continue; // header
    rows.push({ name, url: url || undefined });
  }
  return rows;
}

/** Names already processed in a previous run (for resume). */
function loadProcessed(): Set<string> {
  if (!existsSync(PROGRESS_PATH)) return new Set();
  const done = new Set<string>();
  for (const line of readFileSync(PROGRESS_PATH, 'utf8').split(/\r?\n/)) {
    const name = line.split('\t')[0];
    if (name) done.add(name);
  }
  return done;
}

function toCsvLine(row: DiscoveryRow): string {
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
    csvCell(''),
    csvCell(row.detection.note ?? `discovered, confidence ${row.detection.confidence}`),
    csvCell(''),
    csvCell('no'),
  ].join(',');
}

export async function discoverMaisons(options: {
  /** A `nom,url` CSV roster (required at scale — the world list). */
  inputFile: string;
  /** Cap the number of Maisons processed this run; 0 = all remaining. */
  limit?: number;
  /** Parallel browser detections. Keep low — each opens a real page. */
  concurrency?: number;
  /** Re-process everything, ignoring the resume log. */
  fresh?: boolean;
}): Promise<{ processed: number; discovered: number; skipped: number; unresolved: number; outPath: string }> {
  const concurrency = options.concurrency ?? 3;

  const known = new Set(loadSourceCatalog().map((s) => resolveCompany(s.maison).companyId));
  const processed = options.fresh ? new Set<string>() : loadProcessed();

  // Prepare output files. The review CSV gets a header once; results are appended
  // as they resolve, so a crash keeps everything found so far.
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  if (options.fresh || !existsSync(OUT_PATH)) {
    writeFileSync(
      OUT_PATH,
      'maison,careers_domain,kind,entry_url,job_url_pattern,robots_verdict,job_count,verified\n',
      'utf8',
    );
  }
  if (options.fresh || !existsSync(UNRESOLVED_PATH)) {
    // The manual-pass queue: name + homepage, so a human can find the careers/ATS
    // URL the crawler could not (Loïc: some will only be found by hand).
    writeFileSync(UNRESOLVED_PATH, 'nom,site,raison\n', 'utf8');
  }
  if (options.fresh) writeFileSync(PROGRESS_PATH, '', 'utf8');

  const roster = parseRosterCsv(readFileSync(options.inputFile, 'utf8'));
  const dead = loadDeadNames();
  let queue = roster.filter(
    (c) =>
      !processed.has(c.name) &&
      !known.has(resolveCompany(c.name).companyId) &&
      !dead.has(c.name.toLowerCase()),
  );
  const skippedKnownOrDone = roster.length - queue.length;
  if (options.limit && options.limit > 0) queue = queue.slice(0, options.limit);

  const limit = pLimit(concurrency);
  let discovered = 0;
  let unresolved = 0;

  await Promise.all(
    queue.map((company) =>
      limit(async () => {
        let status = 'unresolved';
        let kind = '';
        try {
          // API-FIRST (the key path, Loïc 2026-09-03): probe the public ATS APIs
          // directly from the brand name + site URL. This BYPASSES a bot-blocked
          // marketing homepage entirely — the ATS API is public even when the
          // site 403s (verified: Lacoste homepage 403 -> careers.lacoste.com API
          // 461 offers). Cheap, no browser, and it resolves the Cloudflare brands
          // the homepage crawl never could. The browser is only the fallback.
          let detection = await probeAtsBySlug(company.name, undefined, company.url);
          if (!detection && company.url) {
            // Fallback: read the homepage in a browser (depth 2: homepage ->
            // careers landing -> ATS) for brands whose ATS the probes missed.
            detection = await inspectCareerPage(company.url, 2, fetchRenderedHtml);
          }
          if (detection) {
            kind = KIND_FOR_TYPE[detection.type] ?? detection.type.toLowerCase();
            appendFileSync(OUT_PATH, toCsvLine({ maison: company.name, kind, detection }) + '\n');
            discovered++;
            status = detection.type === 'GENERIC_JSONLD' ? 'generic' : 'ats';
          } else {
            unresolved++;
            appendFileSync(
              UNRESOLVED_PATH,
              `${csvCell(company.name)},${csvCell(company.url ?? '')},${csvCell('no ATS/careers found')}\n`,
            );
          }
        } catch {
          unresolved++;
          status = 'error';
          appendFileSync(
            UNRESOLVED_PATH,
            `${csvCell(company.name)},${csvCell(company.url ?? '')},${csvCell('fetch/timeout/403 error')}\n`,
          );
        }
        // Record progress LAST, so an interrupted Maison re-runs next time.
        appendFileSync(PROGRESS_PATH, `${company.name}\t${status}\t${kind}\n`);
      }),
    ),
  );

  return {
    processed: queue.length,
    discovered,
    skipped: skippedKnownOrDone,
    unresolved,
    outPath: OUT_PATH,
  };
}
