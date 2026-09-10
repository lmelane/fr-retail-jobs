/**
 * Volume and access validation of ONE catalogued source candidate (status DRAFT), the step `promoteSource` requires
 * between `registerSourceCandidate` and the identity review: a DATED robots verdict read at the source and at least one
 * really parsed posting behind `verifiedJobCount`.
 *
 * Usage: npx tsx apps/aggregator/scripts/coverage/validate-candidate.mts <sourceKey> [--write] [--deadline-ms=600000]
 *
 * Without --write nothing is stored: the tool prints what it read (robots verdict, postings, native employer labels,
 * countries, enumeration proof). With --write it stores robotsVerdict / robotsCheckedAt / verifiedJobCount on the
 * DRAFT (or PAUSED) row only — never on an ACTIVE source, never the status. The verdict comes from the robots.txt of
 * the host the ADAPTER calls (API host for Lever / Greenhouse / SmartRecruiters, the configured origin otherwise),
 * evaluated for `User-agent: *` on the first request path the adapter uses.
 */
import { PrismaClient, type AtsType } from '@prisma/client';
import { KIND_TO_ATS } from '../../src/ats/catalogKinds.js';
import { fetchAtsJobs } from '../../src/ats/index.js';
import { closeBrowser } from '../../src/lib/browser.js';
import { robotsVerdictFor } from '../../src/lib/robotsVerdict.js';

const key = process.argv[2];
if (!key || key.startsWith('--')) { console.error('usage: validate-candidate.mts <sourceKey> [--write] [--deadline-ms=N]'); process.exit(2); }
const write = process.argv.includes('--write');
const deadlineMs = Number(process.argv.find((a) => a.startsWith('--deadline-ms='))?.slice(14) ?? 600_000);

/** Host + first path the adapter requests, per kind — only what the adapters actually call. */
function requestTarget(kind: string, config: Record<string, unknown>): { origin: string; path: string } {
  const str = (k: string) => (typeof config[k] === 'string' ? String(config[k]) : '');
  switch (kind) {
    case 'lever': return { origin: str('region') === 'eu' ? 'https://api.eu.lever.co' : 'https://api.lever.co', path: `/v0/postings/${str('site')}` };
    case 'greenhouse': return { origin: 'https://boards-api.greenhouse.io', path: `/v1/boards/${str('board')}/jobs` };
    case 'smartrecruiters': case 'smartrecruiters-whitelabel': return { origin: 'https://api.smartrecruiters.com', path: `/v1/companies/${str('company')}/postings` };
    case 'workday': return { origin: str('origin'), path: `/wday/cxs/${str('tenant')}/${str('site')}/jobs` };
    case 'teamtailor': { const u = new URL(str('jobs_url') || str('origin') || `https://${str('subdomain')}.teamtailor.com/jobs`); return { origin: u.origin, path: u.pathname || '/jobs' }; }
    case 'digitalrecruiters': return { origin: `https://${str('domainName') || str('domain')}`, path: '/' };
    default: {
      const candidate = str('origin') || str('listingUrl') || str('jobs_url') || str('sitemapUrl') || str('careers_url') || (str('domainName') || str('domain') ? `https://${str('domainName') || str('domain')}` : '');
      if (!candidate) throw new Error(`${kind}: no request origin in the configuration (origin / listingUrl / jobs_url / sitemapUrl / domainName)`);
      const u = new URL(candidate); return { origin: u.origin, path: u.pathname || '/' };
    }
  }
}

const prisma = new PrismaClient({ log: [] });
try {
  const source = await prisma.source.findUniqueOrThrow({ where: { key } });
  if (write && source.status === 'ACTIVE') throw new Error(`${key} is ACTIVE: the validation tool never rewrites an active source`);
  const config = (source.config ?? {}) as Record<string, unknown>;
  const ats = KIND_TO_ATS[source.kind] as AtsType | undefined;
  if (!ats) throw new Error(`${key}: kind "${source.kind}" has no adapter`);
  const target = requestTarget(source.kind, config);
  let robots: string | null = null;
  try { const res = await fetch(`${target.origin}/robots.txt`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; ModeCareersBot/1.0)' }, signal: AbortSignal.timeout(20_000) }); robots = res.ok ? await res.text() : null; } catch { robots = null; }
  const robotsVerdict = robotsVerdictFor(robots, target.path);
  const robotsCheckedAt = new Date();
  const started = Date.now();
  const result = await fetchAtsJobs(ats, { ...config, deadlineMs: Date.now() + deadlineMs });
  const parsed = result.jobs.filter((j) => j.title && j.url && j.externalId);
  const labels = new Map<string, number>();
  for (const j of result.jobs) { const l = j.employerEvidence?.rawName ?? j.company ?? '(catalogue label)'; labels.set(l, (labels.get(l) ?? 0) + 1); }
  const countries = new Map<string, number>();
  for (const j of result.jobs) { const c = j.country ?? '(none)'; countries.set(c, (countries.get(c) ?? 0) + 1); }
  const report = {
    key, status: source.status, kind: source.kind, ats, request: target, robotsVerdict, robotsCheckedAt: robotsCheckedAt.toISOString(), robotsPresent: robots !== null,
    fetched: result.jobs.length, parsed: parsed.length, declaredTotal: result.declaredTotal ?? null, complete: result.complete ?? null, truncated: result.truncated ?? null,
    enumeration: result.enumeration ? { method: result.enumeration.method, termination: result.enumeration.termination, issues: result.enumeration.issues, scopes: result.enumeration.scopes } : null,
    rejectedRows: result.rejectedRows?.length ?? 0, held: result.jobs.filter((j) => j.publicationHold).length,
    labels: [...labels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15), countries: [...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    sampleTitles: parsed.slice(0, 5).map((j) => `${j.title} — ${j.location ?? ''}`), seconds: Math.round((Date.now() - started) / 1000), written: false as boolean,
  };
  if (write) {
    await prisma.source.update({ where: { key }, data: { robotsVerdict, robotsCheckedAt, verifiedJobCount: parsed.length, note: [source.note, `${robotsCheckedAt.toISOString().slice(0, 10)} validate-candidate: robots ${robotsVerdict} on ${target.origin}${target.path}; ${parsed.length} parsed postings (${result.jobs.length} fetched, complete=${result.complete ?? 'n/a'})`].filter(Boolean).join('\n') } });
    report.written = true;
  }
  console.log(JSON.stringify(report, null, 1));
} finally {
  await closeBrowser().catch(() => undefined);
  await prisma.$disconnect();
}
