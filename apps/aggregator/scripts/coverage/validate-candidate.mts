/**
 * Volume, access and perimeter validation of ONE catalogued source candidate (status DRAFT), the step `promoteSource`
 * requires between `registerSourceCandidate` and the identity review: a DATED, EXPLICIT robots verdict read at the source,
 * at least one really parsed posting behind `verifiedJobCount`, and the native employer labels the board publishes,
 * classified against the catalogued Maison (the perimeter evidence the certification must be consistent with).
 *
 * Usage: npx tsx apps/aggregator/scripts/coverage/validate-candidate.mts <sourceKey> [--write] [--deadline-ms=600000] [--proof=<file.json>]
 *
 * Without --write nothing is stored: the tool prints what it read. With --write it stores robotsVerdict / robotsCheckedAt /
 * verifiedJobCount on the DRAFT (or PAUSED) row only — never on an ACTIVE source, never the status. --proof writes the full
 * report (labels, countries, enumeration, robots basis) to a file the certification step reads.
 *
 * Access verdict, explicit by construction (RFC 9309 §2.3.1): the robots.txt of the host the ADAPTER calls is fetched and
 * its HTTP status recorded — 2xx → the `User-agent: *` rules are evaluated on the first request path (ALLOWED / DISALLOWED);
 * 404/410 → NO_ROBOTS (no file: the RFC allows access, but the catalogue keeps this distinct from a read ALLOWED);
 * anything else (401/403/429/5xx, network error, timeout) → UNREACHABLE (the RFC says assume disallow). Only a read ALLOWED
 * is promotable (`isAllowedAccessVerdict`); nothing is ever promoted on an absent or unreachable file.
 */
import { writeFileSync } from 'node:fs';
import { PrismaClient, type AtsType } from '@prisma/client';
import { KIND_TO_ATS } from '../../src/ats/catalogKinds.js';
import { fetchAtsJobs } from '../../src/ats/index.js';
import { closeBrowser } from '../../src/lib/browser.js';
import { CATALOGUE_LABEL, readRobots, requestTarget, scopeEvidence as perimeterEvidence } from '../../src/lib/candidateChecks.js';
import { resolveCompany } from '../../src/normalize/company.js';

const key = process.argv[2];
if (!key || key.startsWith('--')) { console.error('usage: validate-candidate.mts <sourceKey> [--write] [--deadline-ms=N] [--proof=<file>]'); process.exit(2); }
const write = process.argv.includes('--write');
const deadlineMs = Number(process.argv.find((a) => a.startsWith('--deadline-ms='))?.slice(14) ?? 600_000);
const proofPath = process.argv.find((a) => a.startsWith('--proof='))?.slice(8);

const prisma = new PrismaClient({ log: [] });
try {
  const source = await prisma.source.findUniqueOrThrow({ where: { key } });
  if (write && source.status === 'ACTIVE') throw new Error(`${key} is ACTIVE: the validation tool never rewrites an active source`);
  const config = (source.config ?? {}) as Record<string, unknown>;
  const ats = KIND_TO_ATS[source.kind] as AtsType | undefined;
  if (!ats) throw new Error(`${key}: kind "${source.kind}" has no adapter`);
  const target = requestTarget(source.kind, config);
  const robots = await readRobots(target.origin, target.path);
  const robotsCheckedAt = new Date();
  const started = Date.now();
  const result = await fetchAtsJobs(ats, { ...config, deadlineMs: Date.now() + deadlineMs });
  const parsed = result.jobs.filter((j) => j.title && j.url && j.externalId);
  const labels = new Map<string, number>();
  for (const j of result.jobs) { const l = j.employerEvidence?.rawName ?? j.company ?? CATALOGUE_LABEL; labels.set(l, (labels.get(l) ?? 0) + 1); }
  const countries = new Map<string, number>();
  for (const j of result.jobs) { const c = j.country ?? '(none)'; countries.set(c, (countries.get(c) ?? 0) + 1); }
  const scopeEvidence = perimeterEvidence(labels, source.maison);
  const classified = scopeEvidence.labels; const other = scopeEvidence.other;
  const report = {
    key, status: source.status, kind: source.kind, ats, request: target, robotsVerdict: robots.verdict, robotsCheckedAt: robotsCheckedAt.toISOString(), robots,
    fetched: result.jobs.length, parsed: parsed.length, declaredTotal: result.declaredTotal ?? null, complete: result.complete ?? null, truncated: result.truncated ?? null,
    enumeration: result.enumeration ? { method: result.enumeration.method, termination: result.enumeration.termination, issues: result.enumeration.issues, scopes: result.enumeration.scopes } : null,
    rejectedRows: result.rejectedRows?.length ?? 0, held: result.jobs.filter((j) => j.publicationHold).length,
    labels: classified.slice(0, 40), countries: [...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12), scopeEvidence,
    withCountry: result.jobs.filter((j) => j.country).length, withDescription: result.jobs.filter((j) => (j.description ?? '').length > 200).length,
    sampleTitles: parsed.slice(0, 5).map((j) => `${j.title} — ${j.location ?? ''}`), seconds: Math.round((Date.now() - started) / 1000), written: false as boolean, sourceUpdatedAt: source.updatedAt.toISOString(),
  };
  if (write) {
    const note = `${robotsCheckedAt.toISOString().slice(0, 10)} validate-candidate: robots ${robots.verdict} (HTTP ${robots.httpStatus ?? 'none'}${robots.sha256 ? `, sha256 ${robots.sha256.slice(0, 12)}` : ''}) on ${target.origin}${target.path}; ${parsed.length} parsed postings (${result.jobs.length} fetched, complete=${result.complete ?? 'n/a'}, declared=${result.declaredTotal ?? 'n/a'}); labels ${scopeEvidence.verdict}${other.length ? ` [${scopeEvidence.other.join('; ')}]` : ''}`;
    await prisma.source.update({ where: { key }, data: { robotsVerdict: robots.verdict, robotsCheckedAt, verifiedJobCount: parsed.length, note: [source.note, note].filter(Boolean).join('\n') } });
    report.written = true;
  }
  if (proofPath) writeFileSync(proofPath, JSON.stringify({ at: new Date().toISOString(), ...report }, null, 1));
  console.log(JSON.stringify(report, null, 1));
} finally {
  await closeBrowser().catch(() => undefined);
  await prisma.$disconnect();
}
