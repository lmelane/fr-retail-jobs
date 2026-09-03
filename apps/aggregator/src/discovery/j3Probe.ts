import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pLimit from 'p-limit';
import { inspectCareerPage } from '../ats/detect.js';
import { fetchText } from '../lib/http.js';
import { configureExternalDnsFromEnv } from '../lib/externalDns.js';
import type { AtsDetection } from '../types.js';

/**
 * J3 — reinforced generic probe over the ALIVE unresolved sites (GO Loïc,
 * 2026-09-03, after a 500-site sample measured ~2% yield with outsized catches:
 * The Swatch Group, Carhartt WIP, YETI, Icebreaker).
 *
 * The first discovery pass browsed the homepage and followed its careers link.
 * This pass re-runs detection with plain fetch (some sites 403 the browser but
 * serve fetch, and vice versa), adds unlinked candidate paths the first pass
 * did not guess, and scans the sitemap. Two hard rules from the GO:
 *   - a sitemap hit is only promoted when a matched page carries a REAL
 *     JSON-LD JobPosting — a URL that merely looks like /job proves nothing;
 *   - a vendor we have no adapter for (iCIMS, ADP, BambooHR…) is recorded in
 *     its own report for a later build-the-adapter decision, never promoted.
 *
 * Verified detections append to sources.discovered.csv (anchored rows — they
 * come from the brand's own site, so the identity gate waves them through).
 * Resumable like discoverMaisons: one progress line per site processed.
 */

const dataUrl = (name: string) => fileURLToPath(new URL(`../../data/${name}`, import.meta.url));
const REACHABILITY = dataUrl('unresolved.reachability.tsv');
const TIMEOUT_RECHECK = dataUrl('unresolved.timeouts-recheck.tsv');
const OUT_DISCOVERED = dataUrl('sources.discovered.csv');
const OUT_NO_ADAPTER = dataUrl('j3.no-adapter.tsv');
const PROGRESS = dataUrl('j3.progress.tsv');

/** AtsType -> catalogue kind, same mapping the main discovery writes. */
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

/** Vendors sighted in the wild that no adapter covers yet — report, don't promote. */
const NO_ADAPTER_VENDORS =
  /(icims\.com|workforcenow\.adp\.com|myjobs\.adp\.com|bamboohr\.com|breezy\.hr|jazzhr\.com|jobvite\.com|paylocity\.com|ukg\.com|taleo\.net|oraclecloud\.com\/hcmUI|dayforcehcm\.com)/i;

/** Paths the shared guesser does not try; measured hits (Icebreaker: /pages/careers). */
const EXTRA_PATHS = ['/pages/careers', '/en/careers', '/company/careers'];

const JSONLD_JOBPOSTING = /"@type"\s*:\s*"JobPosting"/i;
const SITEMAP_JOB_LOC = /<loc>([^<]*(?:\/job|\/career|\/offre|\/annonce|\/vacature|\/stelle)[^<]*)<\/loc>/gi;

const PER_SITE_TIMEOUT_MS = 90_000;

type Site = { nom: string; site: string };

function loadAliveSites(): Site[] {
  const sites = new Map<string, Site>();
  const read = (path: string) => {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, 'utf8').trim().split('\n').slice(1)) {
      const [nom, site, bucket] = line.split('\t');
      if (bucket === 'alive' && nom && site && !sites.has(nom)) sites.set(nom, { nom, site });
    }
  };
  read(REACHABILITY);
  read(TIMEOUT_RECHECK);
  return [...sites.values()];
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function toCsvLine(nom: string, kind: string, detection: AtsDetection): string {
  const domain = (() => {
    try {
      return new URL(detection.careersUrl).hostname;
    } catch {
      return '';
    }
  })();
  return [
    csvCell(nom),
    csvCell(domain),
    csvCell(kind),
    csvCell(JSON.stringify(detection.config)),
    csvCell(''),
    csvCell(`J3 reinforced probe: ${detection.note ?? `confidence ${detection.confidence}`}`),
    csvCell(''),
    csvCell('no'),
  ].join(',');
}

function withDeadline<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`site timeout (${label})`)), PER_SITE_TIMEOUT_MS);
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

/** A sitemap job URL only counts once a listed page really carries a JobPosting. */
async function sitemapDetection(origin: string): Promise<AtsDetection | null> {
  let xml: string;
  try {
    xml = await fetchText(`${origin}/sitemap.xml`);
  } catch {
    return null;
  }
  const jobUrls = [...xml.matchAll(SITEMAP_JOB_LOC)].map((m) => m[1]).slice(0, 3);
  for (const url of jobUrls) {
    try {
      if (JSONLD_JOBPOSTING.test(await fetchText(url))) {
        return {
          type: 'GENERIC_JSONLD',
          careersUrl: `${origin}/sitemap.xml`,
          config: { sitemapUrl: `${origin}/sitemap.xml` },
          confidence: 0.7,
          note: `sitemap job URL verified JSON-LD (${url})`,
        };
      }
    } catch {
      /* one stale URL does not fail the site */
    }
  }
  return null;
}

/** Vendors we cannot ingest yet, sighted on the site's career surfaces. */
async function sightNoAdapterVendor(origin: string): Promise<string | null> {
  for (const path of ['/careers', '/jobs', '']) {
    try {
      const match = NO_ADAPTER_VENDORS.exec(await fetchText(`${origin}${path}`));
      if (match) return match[1];
    } catch {
      /* keep looking */
    }
  }
  return null;
}

async function probeSite({ nom, site }: Site): Promise<{ status: string; detail: string }> {
  let origin: string;
  try {
    origin = new URL(site).origin;
  } catch {
    return { status: 'bad-url', detail: site };
  }

  let detection = await inspectCareerPage(site, 2);
  if (!detection) {
    for (const path of EXTRA_PATHS) {
      detection = await inspectCareerPage(`${origin}${path}`, 0);
      if (detection) break;
    }
  }
  // A generic detection without a proven JobPosting is a pattern match, not a
  // source (the GO's first condition) — the sitemap path below re-proves it.
  if (detection && detection.type === 'GENERIC_JSONLD') {
    const config = detection.config as Record<string, unknown>;
    const proofUrl = String(config.startUrl ?? config.listingUrl ?? '');
    try {
      if (!proofUrl || !JSONLD_JOBPOSTING.test(await fetchText(proofUrl))) detection = null;
    } catch {
      detection = null;
    }
  }
  if (!detection) detection = await sitemapDetection(origin);

  if (detection) {
    const kind = KIND_FOR_TYPE[detection.type] ?? detection.type.toLowerCase();
    appendFileSync(OUT_DISCOVERED, toCsvLine(nom, kind, detection) + '\n');
    return { status: 'discovered', detail: `${kind} ${detection.careersUrl}` };
  }

  const vendor = await sightNoAdapterVendor(origin);
  if (vendor) {
    appendFileSync(OUT_NO_ADAPTER, `${nom}\t${site}\t${vendor}\n`);
    return { status: 'no-adapter', detail: vendor };
  }
  return { status: 'none', detail: '' };
}

async function main(): Promise<void> {
  configureExternalDnsFromEnv();
  const processed = new Set(
    existsSync(PROGRESS)
      ? readFileSync(PROGRESS, 'utf8')
          .split('\n')
          .map((l) => l.split('\t')[0])
          .filter(Boolean)
      : [],
  );
  if (!existsSync(OUT_NO_ADAPTER)) writeFileSync(OUT_NO_ADAPTER, 'nom\tsite\tvendor\n');

  const queue = loadAliveSites().filter((s) => !processed.has(s.nom));
  console.log(`J3: ${queue.length} alive sites to probe (${processed.size} already done)`);

  const limit = pLimit(Number(process.env.J3_CONCURRENCY ?? 12));
  let done = 0;
  const counts: Record<string, number> = {};
  await Promise.all(
    queue.map((site) =>
      limit(async () => {
        let result: { status: string; detail: string };
        try {
          result = await withDeadline(probeSite(site), site.nom);
        } catch (error) {
          result = { status: 'error', detail: error instanceof Error ? error.message.slice(0, 80) : '' };
        }
        counts[result.status] = (counts[result.status] ?? 0) + 1;
        done++;
        if (result.status === 'discovered' || result.status === 'no-adapter' || done % 100 === 0) {
          console.log(`[${done}/${queue.length}] ${site.nom}: ${result.status} ${result.detail}`);
        }
        appendFileSync(PROGRESS, `${site.nom}\t${result.status}\t${result.detail}\n`);
      }),
    ),
  );
  console.log(JSON.stringify({ processed: queue.length, counts }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
