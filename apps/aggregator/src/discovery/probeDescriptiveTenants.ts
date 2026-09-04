import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pLimit from 'p-limit';
import { detectFromHtml, careersLinksInHtml } from '../ats/detect.js';
import { fetchText } from '../lib/http.js';
import { configureExternalDnsFromEnv } from '../lib/externalDns.js';

/**
 * Measure ATS detection coverage on the tenants Loïc's roster still labels
 * DESCRIPTIVELY ("portail", "portail maison", "Board maison", "propre"…) rather
 * than by a vendor name.
 *
 * The question this answers, and nothing else (Loïc, 2026-09-04): "est-ce qu'on
 * détecte correctement l'ATS ?". His own re-probe already reclassified 107 rows
 * from "portail" to a real vendor, which says the descriptive label means "not
 * yet looked at", not "no ATS". So each remaining tenant lands in exactly one
 * of three buckets:
 *
 *   READY       a signature we already read AND an adapter exists -> promotable
 *   NO_ADAPTER  a vendor we can name but cannot ingest -> sizes the Lot 5 build
 *   NONE        no signature at all -> the only rows needing a human look
 *
 * READ-ONLY by construction: it writes a TSV report and touches no table. It is
 * a measurement, not an ingestion — nothing here promotes a source.
 */

const dataUrl = (name: string) => fileURLToPath(new URL(`../../data/${name}`, import.meta.url));
const OUT = dataUrl('tenants.detection.tsv');
const PROGRESS = dataUrl('tenants.detection.progress.tsv');

/** Roster labels that name no vendor — the population under measurement. */
const DESCRIPTIVE =
  /^(portail|portail maison|portail_groupe|board maison|propre|site carri|page carri|careers?-?page|jobboards?|bot-wall|—|-|)$/i;

/**
 * Vendors with NO adapter on our side. Naming one is already a result: it turns
 * "we see nothing" into "we see X, and X costs one adapter" — which is what
 * sizes the build. Kept in sync with src/ats/adapters (verified 2026-09-04).
 */
const NO_ADAPTER_VENDORS: ReadonlyArray<{ re: RegExp; name: string }> = [
  { re: /icims\.com/i, name: 'iCIMS' },
  { re: /taleo\.net|taleo\.com/i, name: 'Taleo' },
  { re: /oraclecloud\.com|\/hcmUI\/|oracle\.com\/hcm/i, name: 'Oracle HCM' },
  { re: /dayforcehcm\.com|dayforce\.com/i, name: 'Dayforce' },
  { re: /csod\.com|cornerstoneondemand/i, name: 'Cornerstone' },
  { re: /pageuppeople\.com|dc\d?\.pageuppeople/i, name: 'PageUp' },
  { re: /beetween\.(com|fr)/i, name: 'Beetween' },
  { re: /workforcenow\.adp\.com|myjobs\.adp\.com/i, name: 'ADP' },
  { re: /bamboohr\.com/i, name: 'BambooHR' },
  { re: /jobvite\.com/i, name: 'Jobvite' },
  { re: /breezy\.hr/i, name: 'Breezy' },
  { re: /jazzhr\.com/i, name: 'JazzHR' },
  { re: /softgarden\.(io|de|com)/i, name: 'Softgarden' },
  { re: /gupy\.io/i, name: 'Gupy' },
  { re: /kallidusrecruit\.com/i, name: 'Kallidus' },
  { re: /ukg\.(com|pro)|ultipro\.com/i, name: 'UKG' },
  { re: /paylocity\.com/i, name: 'Paylocity' },
  { re: /lumesse|talentlink/i, name: 'TalentLink' },
  { re: /flatchr\.io/i, name: 'Flatchr' },
  { re: /factorialhr\.com/i, name: 'Factorial' },
];

function namedVendor(html: string): string | null {
  return NO_ADAPTER_VENDORS.find((v) => v.re.test(html))?.name ?? null;
}

type Tenant = { url: string; kind: string; brands: number; names: string };

/** Split a CSV line honouring quoted fields (brand lists contain commas). */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = !quoted;
    } else if (c === ',' && !quoted) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

function loadTenants(csvPath: string): Tenant[] {
  const lines = readFileSync(csvPath, 'utf8').replace(/^﻿/, '').split('\n').filter(Boolean);
  const header = splitCsv(lines[0]).map((h) => h.trim());
  const col = (n: string) => header.indexOf(n);
  const [iUrl, iKind, iNb, iBrands] = [col('tenant_ou_board'), col('ats_kind'), col('nb_marques'), col('marques')];
  return lines.slice(1).flatMap((line) => {
    const f = splitCsv(line);
    const url = (f[iUrl] ?? '').trim();
    const kind = (f[iKind] ?? '').trim();
    if (!/^https?:\/\//i.test(url)) return [];
    if (!DESCRIPTIVE.test(kind)) return [];
    return [{ url, kind, brands: Number(f[iNb] ?? 0) || 0, names: (f[iBrands] ?? '').slice(0, 120) }];
  });
}

type Verdict = {
  bucket: 'READY' | 'NO_ADAPTER' | 'NONE' | 'DEAD_HOST' | 'BOT_WALL' | 'UNREACHABLE';
  detail: string;
};

/**
 * Why a fetch failed, because the three causes call for three different actions:
 * a host that does not resolve is a dead roster URL (fix the data), a 403/429 is
 * a bot wall (browser transport may still get through), and anything else is
 * ours to retry. Collapsing them into one "fetch failed" hid, on the first run,
 * a site that answered 200 on the very next attempt.
 */
function classifyFailure(error: unknown): Verdict {
  const cause = (error as { cause?: { code?: string } })?.cause?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (cause === 'ENOTFOUND' || cause === 'EAI_AGAIN') {
    return { bucket: 'DEAD_HOST', detail: `DNS ${cause}` };
  }
  if (/HTTP (401|403|429)\b/.test(message)) {
    return { bucket: 'BOT_WALL', detail: message.slice(0, 70) };
  }
  return { bucket: 'UNREACHABLE', detail: `${cause ?? message.slice(0, 70)}` };
}

/**
 * One tenant: fetch its page, run the SAME detection the pipeline uses, and when
 * that finds only a generic fallback, hop once through the page's careers links
 * — a showcase page usually loads its ATS one click away, which is precisely the
 * case this measurement exists to count.
 */
async function probe(tenant: Tenant): Promise<Verdict> {
  let html: string;
  try {
    html = await fetchText(tenant.url);
  } catch (error) {
    return classifyFailure(error);
  }

  const pages: Array<{ url: string; html: string }> = [{ url: tenant.url, html }];
  const direct = detectFromHtml(html, tenant.url);
  if (direct && direct.type !== 'GENERIC_JSONLD') {
    return { bucket: 'READY', detail: `${direct.type} (page)` };
  }

  for (const link of careersLinksInHtml(html, tenant.url).slice(0, 2)) {
    try {
      const sub = await fetchText(link);
      pages.push({ url: link, html: sub });
      const found = detectFromHtml(sub, link);
      if (found && found.type !== 'GENERIC_JSONLD') return { bucket: 'READY', detail: `${found.type} (${link})` };
    } catch { /* a dead careers link is not a verdict */ }
  }

  for (const page of pages) {
    const vendor = namedVendor(page.html);
    if (vendor) return { bucket: 'NO_ADAPTER', detail: `${vendor} (${page.url})` };
  }

  // A generic fallback carrying real JobPosting data is still ingestible today.
  if (direct?.type === 'GENERIC_JSONLD' && /"@type"\s*:\s*"JobPosting"/i.test(html)) {
    return { bucket: 'READY', detail: 'GENERIC_JSONLD (JobPosting présent)' };
  }
  return { bucket: 'NONE', detail: 'aucune signature' };
}

export async function runProbeDescriptiveTenants(csvPath: string): Promise<void> {
  configureExternalDnsFromEnv();
  const tenants = loadTenants(csvPath);

  const done = new Set(
    existsSync(PROGRESS)
      ? readFileSync(PROGRESS, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')[0])
      : [],
  );
  if (!existsSync(OUT)) writeFileSync(OUT, 'url\tkind\tmarques\tbucket\tdetail\tnoms\n');

  const todo = tenants.filter((t) => !done.has(t.url));
  console.log(`[detect] ${tenants.length} tenants descriptifs, ${todo.length} à sonder`);

  // Deliberately low: the first run at 6 reported "fetch failed" on hosts that
  // answered 200 on the very next single request (careers.loreal.com). Each
  // tenant costs up to three fetches, and hostGate already serialises per host,
  // so extra width buys little and manufactures false negatives — which would be
  // the worst possible outcome for a measurement meant to decide what to build.
  const limit = pLimit(3);
  let n = 0;
  await Promise.all(
    todo.map((tenant) =>
      limit(async () => {
        const verdict = await probe(tenant);
        appendFileSync(
          OUT,
          `${tenant.url}\t${tenant.kind}\t${tenant.brands}\t${verdict.bucket}\t${verdict.detail}\t${tenant.names}\n`,
        );
        appendFileSync(PROGRESS, `${tenant.url}\t${verdict.bucket}\n`);
        n += 1;
        if (n % 25 === 0) console.log(`[detect] ${n}/${todo.length}`);
      }),
    ),
  );

  const rows = readFileSync(OUT, 'utf8').split('\n').slice(1).filter(Boolean).map((l) => l.split('\t'));
  const tally = new Map<string, { tenants: number; brands: number }>();
  for (const [, , brands, bucket] of rows) {
    const cur = tally.get(bucket) ?? { tenants: 0, brands: 0 };
    tally.set(bucket, { tenants: cur.tenants + 1, brands: cur.brands + (Number(brands) || 0) });
  }
  console.log('\n[detect] RÉSULTAT');
  for (const [bucket, { tenants: t, brands }] of [...tally].sort((a, b) => b[1].tenants - a[1].tenants)) {
    console.log(`  ${bucket.padEnd(12)} ${String(t).padStart(4)} tenants  ${String(brands).padStart(4)} marques`);
  }
  console.log(`  rapport: ${OUT}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const csv = process.argv[2] ?? '/Users/lmelane/Downloads/Kimi_Agent_Marques/regroupement-par-tenant.csv';
  runProbeDescriptiveTenants(csv).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
