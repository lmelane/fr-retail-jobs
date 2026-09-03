import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pLimit from 'p-limit';
import { fetchText, fetchJson } from '../lib/http.js';
import { ATS_TYPE } from '../pipeline/validateSources.js';
import { closeBrowser } from '../lib/browser.js';
import { loadRows, fetchWithOneRetry, type Row } from './validateDiscovered.js';
import type { NormalizedJob } from '../types.js';

/**
 * Identity gate over data/sources.discovered.csv (decision, 2026-09-03).
 *
 * The stratified sample proved that rows resolved by BARE SLUG PROBE are ~70%
 * wrong-company or demo boards ("Supreme" -> an HVAC firm, "Fox-Wizel" -> a
 * veterinary hospital, "Eric Bompard" -> a board whose only job is titled
 * "(Exemple)"). Rows anchored to the brand's own domain (tech-scan CNAME, ATS
 * link found on the brand's site, custom careers domain) were almost all right.
 *
 * So the gate is: anchored rows pass; slug-probed rows must PROVE identity —
 * the board's own display name must match the maison (tolerantly: casing,
 * accents, legal suffixes, brand vs legal entity), or the offers must live on
 * the brand's own domain. Everything else goes to manual review WITH evidence
 * (board name, sample titles, a job URL), never silently dropped.
 *
 * Outputs:
 *   data/sources.gated.csv         rows that passed (same schema, verified=gate status)
 *   data/sources.manual-review.tsv rows needing a human, with evidence
 *   data/sources.dead.tsv          rows whose feed errored or vanished
 */

const OUT_GATED = fileURLToPath(new URL('../../data/sources.gated.csv', import.meta.url));
const OUT_MANUAL = fileURLToPath(new URL('../../data/sources.manual-review.tsv', import.meta.url));
const OUT_DEAD = fileURLToPath(new URL('../../data/sources.dead.tsv', import.meta.url));

/** Vendor-owned hosts: a subdomain there is the probe's own echo, not evidence. */
const VENDOR_DOMAINS = [
  'teamtailor.com',
  'personio.de',
  'personio.com',
  'recruitee.com',
  'greenhouse.io',
  'lever.co',
  'welcometothejungle.com',
  'smartrecruiters.com',
  'myworkdayjobs.com',
];

/** Legal/corporate noise stripped before comparing names. */
const NAME_NOISE =
  /\b(sas|sasu|sarl|sa|sl|srl|spa|s\.p\.a|ltd|limited|llc|inc|incorporated|gmbh|ag|kg|bv|ab|as|oy|plc|co|company|corp|corporation|group|groupe|holding|holdings|maison|the|and|et)\b/g;

function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(NAME_NOISE, ' ')
    .split(' ')
    .filter((t) => t.length > 1);
}

/**
 * Tolerant, ASYMMETRIC name match.
 *
 * "Pepco" vs "PEPCO Germany GmbH" must pass (brand inside its legal entity),
 * but "Lush Lapel" vs "Lush" must NOT: a shorter board name swallowed by a
 * longer maison name is exactly how the wrong Lush claimed Lush Lapel. A
 * single-token board name therefore only matches a single-token maison.
 */
export function namesMatch(maison: string, boardName: string): boolean {
  const a = nameTokens(maison);
  const b = nameTokens(boardName);
  if (!a.length || !b.length) return false;

  const aSet = new Set(a);
  const bSet = new Set(b);
  const aInB = a.every((t) => bSet.has(t));
  const bInA = b.every((t) => aSet.has(t));

  // Maison ⊆ board name (its legal-entity form). A single-token maison inside a
  // LONG board name is how "Supreme" matched an HVAC firm, so it only tolerates
  // one extra token ("PEPCO Germany", "Shinola Detroit" — not "Supreme Heating
  // Air Conditioning").
  if (aInB) return a.length >= 2 || b.length <= 2;
  if (bInA) return b.length >= 2 || a.length === 1; // board ⊆ maison, guarded
  const shared = a.filter((t) => bSet.has(t)).length;
  return shared / (a.length + b.length - shared) >= 0.6;
}

/** Domain core: "careers.aroma-zone.com" -> "aromazone"; vendor hosts -> null. */
function domainCore(host: string): string | null {
  const clean = host.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!clean || VENDOR_DOMAINS.some((vendor) => clean === vendor || clean.endsWith(`.${vendor}`))) {
    return null;
  }
  const labels = clean.split('.').filter((l) => !['www', 'careers', 'career', 'jobs', 'job', 'com', 'fr', 'de', 'io', 'co', 'net', 'org', 'uk', 'it', 'es', 'se', 'dk', 'nl', 'eu'].includes(l));
  return labels.join('').replace(/[^a-z0-9]/g, '') || null;
}

/** The brand's own domain vouching for a slug row: exact-ish, never a 4-letter echo. */
export function domainMatches(maison: string, host: string): boolean {
  const core = domainCore(host);
  if (!core) return false;
  const joined = nameTokens(maison).join('');
  if (!joined) return false;
  if (core === joined) return true;
  const shorter = core.length <= joined.length ? core : joined;
  return shorter.length >= 5 && (core.includes(joined) || joined.includes(core));
}

const DEMO_TITLE = /\b(exemple|example|demo|sample|test)\b|\(exemple\)/i;

/** Board display name, fetched from the vendor's own metadata per kind. */
async function fetchBoardName(row: Row, jobs: NormalizedJob[]): Promise<string> {
  try {
    switch (row.kind) {
      case 'greenhouse': {
        const board = String(row.config.board ?? '');
        const meta = await fetchJson<{ name?: string }>(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}`,
        );
        return meta.name ?? '';
      }
      case 'smartrecruiters-whitelabel': {
        const company = String(row.config.company ?? '');
        const meta = await fetchJson<{ name?: string }>(
          `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}`,
        );
        return meta.name ?? '';
      }
      case 'personio': {
        // The adapter already fetched the XML feed; every position carries the
        // legal entity in <subcompany>.
        const sub = (jobs[0]?.raw as any)?.subcompany;
        if (sub) return String(sub);
        return titleOf(await fetchText(`https://${String(row.config.host ?? '')}/`));
      }
      case 'teamtailor':
        return titleOf(await fetchText(String(row.config.origin ?? '')));
      case 'recruitee':
        return titleOf(await fetchText(`https://${String(row.config.subdomain ?? '')}.recruitee.com/`));
      case 'lever':
        return titleOf(await fetchText(`https://jobs.lever.co/${String(row.config.site ?? '')}`));
      case 'wttj':
        return titleOf(
          await fetchText(`https://www.welcometothejungle.com/fr/companies/${String(row.config.slug ?? '')}`),
        );
      default:
        return '';
    }
  } catch {
    return '';
  }
}

/** "<title>Jobs at Aroma-Zone</title>" -> "Aroma-Zone", stripped of boilerplate. */
function titleOf(html: string): string {
  const raw = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
  const meta = /property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1];
  const withMeta = meta || raw;
  return withMeta
    .replace(/&amp;/g, '&')
    .replace(/\b(jobs?|careers?|karriere|recrutement|join us|work with us|current openings|offres d'emploi|at|chez|bei)\b/gi, ' ')
    .replace(/[|–—:·-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Gate = {
  row: Row;
  status: 'anchored' | 'validated-name' | 'validated-domain' | 'manual_review' | 'dead';
  boardName: string;
  jobs: number;
  sampleTitles: string;
  sampleUrl: string;
  reason: string;
};

function slugKey(row: Row): string {
  const id =
    row.config.board ?? row.config.site ?? row.config.subdomain ?? row.config.slug ?? row.config.company ?? row.config.host ?? row.config.origin ?? '';
  return `${row.kind}|${String(id).toLowerCase()}`;
}

async function gateSlugRow(row: Row): Promise<Gate> {
  const type = ATS_TYPE[row.kind];
  let jobs: NormalizedJob[] = [];
  try {
    jobs = await fetchWithOneRetry(type, row);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 140) : String(error);
    return { row, status: 'dead', boardName: '', jobs: 0, sampleTitles: '', sampleUrl: '', reason: message };
  }

  // The vendor's metadata first; else whatever employer name the feed itself
  // carries (SmartRecruiters postings embed company.name, Personio subcompany).
  const raw = jobs[0]?.raw as any;
  const boardName =
    (await fetchBoardName(row, jobs)) ||
    jobs[0]?.company ||
    String(raw?.company?.name ?? raw?.subcompany ?? raw?.organization?.name ?? '');
  const sampleTitles = jobs.slice(0, 3).map((j) => j.title).join(' | ');
  const sampleUrl = jobs[0]?.url ?? '';
  const base = { row, boardName, jobs: jobs.length, sampleTitles, sampleUrl };

  const demoCount = jobs.filter((j) => DEMO_TITLE.test(j.title)).length;
  if (jobs.length > 0 && demoCount >= Math.ceil(jobs.length / 2)) {
    return { ...base, status: 'manual_review', reason: 'demo/sandbox board (titles look like samples)' };
  }

  // Evidence 1 — the vendor's own display name for this board.
  if (boardName && namesMatch(row.maison, boardName)) {
    return { ...base, status: 'validated-name', reason: `board name "${boardName}"` };
  }
  // Evidence 2 — the offers (or the configured origin) live on the brand's own domain.
  const hosts = [
    String(row.config.origin ?? ''),
    String(row.config.host ?? ''),
    row.careersDomain,
    sampleUrl,
  ].filter(Boolean);
  for (const host of hosts) {
    try {
      const hostname = host.startsWith('http') ? new URL(host).hostname : host;
      if (domainMatches(row.maison, hostname)) {
        return { ...base, status: 'validated-domain', reason: `own domain ${hostname}` };
      }
    } catch {
      /* not a URL — skip */
    }
  }

  if (jobs.length === 0 && !boardName) {
    return { ...base, status: 'dead', reason: 'no jobs and no board metadata' };
  }
  return {
    ...base,
    status: 'manual_review',
    reason: boardName ? `board name "${boardName}" ≠ maison` : 'no board name to compare',
  };
}

async function main(): Promise<void> {
  const rows = loadRows();
  const isSlugProbe = (row: Row) => /slug probe/i.test(row.robotsVerdict);
  const anchored = rows.filter((row) => !isSlugProbe(row));
  const slugRows = rows.filter(isSlugProbe);
  console.log(`${rows.length} rows: ${anchored.length} anchored (auto-pass), ${slugRows.length} slug-probed to verify`);

  const limit = pLimit(Number(process.env.GATE_CONCURRENCY ?? 6));
  let done = 0;
  const gated = await Promise.all(
    slugRows.map((row) =>
      limit(async () => {
        const result = await gateSlugRow(row);
        done++;
        console.log(`[${done}/${slugRows.length}] ${row.maison} (${row.kind}): ${result.status} — ${result.reason}`);
        return result;
      }),
    ),
  );

  /**
   * Shared-board arbitration: several maisons claiming one board ("Oliver
   * Logan" and "Oliver Spencer" both on greenhouse "oliver") cannot all be
   * right. If the board name singled out exactly one claimant, the others
   * demote to manual review; if none matched, they are all already there.
   */
  const byBoard = new Map<string, Gate[]>();
  for (const gate of gated) {
    const key = slugKey(gate.row);
    byBoard.set(key, [...(byBoard.get(key) ?? []), gate]);
  }
  const arbitrated: Gate[] = [];
  for (const claims of byBoard.values()) {
    const winners = claims.filter((g) => g.status === 'validated-name');
    for (const gate of claims) {
      if (claims.length > 1 && gate.status.startsWith('validated') && winners.length !== 1) {
        arbitrated.push({ ...gate, status: 'manual_review', reason: `${gate.reason}; board claimed by ${claims.length} maisons` });
      } else if (claims.length > 1 && gate.status === 'validated-domain' && winners.length === 1 && !winners.includes(gate)) {
        arbitrated.push({ ...gate, status: 'manual_review', reason: `${gate.reason}; board name matches "${winners[0].row.maison}"` });
      } else {
        arbitrated.push(gate);
      }
    }
  }

  const passed = arbitrated.filter((g) => g.status.startsWith('validated'));
  const manual = arbitrated.filter((g) => g.status === 'manual_review');
  const dead = arbitrated.filter((g) => g.status === 'dead');

  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const csvRow = (row: Row, status: string) =>
    [
      escape(row.maison),
      escape(row.careersDomain),
      escape(row.kind),
      escape(JSON.stringify(row.config)),
      '""',
      escape(row.robotsVerdict),
      '""',
      escape(status),
    ].join(',');

  writeFileSync(
    OUT_GATED,
    'maison,careers_domain,kind,entry_url,job_url_pattern,robots_verdict,job_count,verified\n' +
      [...anchored.map((row) => csvRow(row, 'anchored')), ...passed.map((g) => csvRow(g.row, g.status))].join('\n') +
      '\n',
  );

  const clean = (value: string) => value.replace(/[\t\n\r]+/g, ' ');
  const tsv = (gates: Gate[]) =>
    'maison\tkind\tconfig\tboard_name\tjobs\tsample_titles\tsample_url\treason\n' +
    gates
      .map((g) =>
        [
          clean(g.row.maison),
          g.row.kind,
          clean(JSON.stringify(g.row.config)),
          clean(g.boardName),
          g.jobs,
          clean(g.sampleTitles),
          clean(g.sampleUrl),
          clean(g.reason),
        ].join('\t'),
      )
      .join('\n') + '\n';
  writeFileSync(OUT_MANUAL, tsv(manual));
  writeFileSync(OUT_DEAD, tsv(dead));

  const byStatus = (status: string) => arbitrated.filter((g) => g.status === status).length;
  console.log(
    `\nanchored ${anchored.length} | validated-name ${byStatus('validated-name')} | validated-domain ${byStatus('validated-domain')} | manual_review ${manual.length} | dead ${dead.length}`,
  );
  console.log(`fiable total: ${anchored.length + passed.length}`);
  console.log(`-> ${OUT_GATED}\n-> ${OUT_MANUAL}\n-> ${OUT_DEAD}`);
}

// Run only when executed directly, so importing the match helpers stays inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } finally {
    await closeBrowser();
  }
}
