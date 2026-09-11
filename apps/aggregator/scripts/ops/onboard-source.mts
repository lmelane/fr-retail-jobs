/**
 * The full onboarding path of a NEW source, run on a clone: register → validate → certify → promote → ingest.
 *
 * Every step calls the maintained pipeline function, never a local copy:
 *   register   `registerSourceCandidate`        (connectors/sourceStore)
 *   validate   `readRobots` + `fetchAtsJobs` + `scopeEvidence`   (lib/candidateChecks, ats/index)
 *   certify    `recordSourceIdentityReview`     (connectors/sourceIdentity) — refuses without archived evidence
 *   promote    `promoteSource`                  (connectors/sourceStore)  — refuses an uncertified source
 *   ingest     `ingestAllBySource`              (pipeline/ingestOrchestrator)
 *
 * Offline: only the HTTP transport is replaced (scripts/ops/offline-transport.ts), so the adapters, the identity
 * gate, the scope rules, dedup and the upsert all run for real.
 *
 * The state and the proof are read back after EVERY transition — a step that "succeeded" without moving the
 * source's state would otherwise pass unnoticed.
 *
 * Clone only: the guard is the database name.
 *
 * usage: onboard-source.mts <dossier.json> [--from=register]
 *   the dossier carries the candidate's configuration and its archived official evidence (see type Dossier).
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { installOfflineTransport } from './offline-transport.js';

type Dossier = {
  key: string; maison: string; kind: string; tier: string; config: Record<string, unknown>; careersDomain: string;
  /** Archived official page that names the configured board — the certification evidence. */
  evidenceFile: string; officialDomain: string; proofUrl: string; portalUrl: string; portalScope: 'SINGLE_BRAND' | 'MULTI_BRAND';
  statement: string;
  /** Recorded responses for this source's requests. */
  cassette: string;
};

const dossierFile = process.argv[2];
if (!dossierFile) { console.error('usage: onboard-source.mts <dossier.json> [--from=register]'); process.exit(2); }
const dossier: Dossier = JSON.parse(readFileSync(dossierFile, 'utf8'));
installOfflineTransport({ mode: 'replay', dir: dossier.cassette });

const OUT = 'backups/lot4-20260909/p10-onboard';
mkdirSync(OUT, { recursive: true });
const steps: any[] = [];
const p = new PrismaClient({ log: [] });

try {
  const [{ current_database: db }]: any[] = await p.$queryRaw`SELECT current_database()`;
  if (!/replay|clone|test/.test(db)) throw new Error(`refusing: ${db} is not a clone/replay/test database`);

  /** The source's state and its certification, re-read after each transition. */
  const stateOf = async () => {
    const source = await p.source.findUnique({ where: { key: dossier.key }, select: { key: true, status: true, tenantKey: true, kind: true, config: true, maison: true, careersDomain: true, tier: true } });
    const review = await p.sourceIdentityReview.findFirst({ where: { sourceKey: dossier.key }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    let certification = 'NO_REVIEW';
    if (source && review) {
      const { assertIdentityReview } = await import('../../src/connectors/sourceIdentity.js');
      try { assertIdentityReview(source as any, review); certification = 'CERTIFIED'; } catch (e) { certification = `INVALID: ${(e as Error).message.replace(/^promote: /, '').slice(0, 70)}`; }
    }
    const postings: any[] = await p.$queryRaw`
      SELECT COUNT(*)::int representations, COUNT(DISTINCT j.id)::int jobs
      FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."sourceKey" = ${dossier.key} AND js."isActive" AND j."isActive"`;
    return { exists: !!source, status: source?.status ?? null, certification, ...postings[0] };
  };

  const record = async (step: string, result: unknown) => {
    const after = await stateOf();
    steps.push({ step, result, after });
    console.log(`${step.padEnd(9)} → ${JSON.stringify(after)}`);
    return after;
  };

  await record('initial', null);

  // ── register ────────────────────────────────────────────────────────────────
  const { registerSourceCandidate } = await import('../../src/connectors/sourceCandidate.js');
  const { promoteSource } = await import('../../src/connectors/sourceStore.js');
  await record('register', await registerSourceCandidate(p as any, {
    key: dossier.key, maison: dossier.maison, kind: dossier.kind, tier: dossier.tier,
    config: dossier.config, careersDomain: dossier.careersDomain,
  } as any));

  // ── validate ────────────────────────────────────────────────────────────────
  const { KIND_TO_ATS } = await import('../../src/ats/catalogKinds.js');
  const { fetchAtsJobs } = await import('../../src/ats/index.js');
  const { readRobots, requestTarget, scopeEvidence } = await import('../../src/lib/candidateChecks.js');
  const target = requestTarget(dossier.kind as any, dossier.config);
  const robots = await readRobots(target.origin, target.path);
  const read = await fetchAtsJobs(KIND_TO_ATS[dossier.kind] as any, dossier.config);
  const jobs = Array.isArray(read) ? read : read.jobs;
  // scopeEvidence takes the label -> count map the validator builds, not a flat list.
  const labels = new Map<string, number>();
  for (const j of jobs as any[]) {
    const label = j.employerEvidence?.rawName ?? j.company;
    if (label) labels.set(label, (labels.get(label) ?? 0) + 1);
  }
  const evidence = scopeEvidence(labels, dossier.maison);
  const validation = { at: new Date().toISOString(), key: dossier.key, robotsVerdict: robots.verdict, robots, parsed: jobs.length, scopeEvidence: evidence };
  writeFileSync(`${OUT}/validate-${dossier.key}.json`, JSON.stringify(validation, null, 1));
  if (robots.verdict !== 'ALLOWED') throw new Error(`${dossier.key}: robots verdict is ${robots.verdict}, only a read ALLOWED is promotable`);
  if (!jobs.length) throw new Error(`${dossier.key}: the adapter parsed no posting — nothing to certify`);
  /**
   * The verdict is STORED, as validate-candidate does. Promotion refuses a source without a dated robots verdict
   * in the database — reading robots.txt in memory is not evidence the catalogue can show later. The refusal was
   * observed on the first run of this path and is the guard working, not an obstacle to route around.
   */
  const robotsCheckedAt = new Date();
  await p.source.update({ where: { key: dossier.key }, data: {
    robotsVerdict: robots.verdict, robotsCheckedAt, verifiedJobCount: jobs.length,
    note: `${robotsCheckedAt.toISOString().slice(0, 10)} onboarding: robots ${robots.verdict} (HTTP ${robots.httpStatus ?? 'none'}) on ${target.origin}${target.path}; ${jobs.length} parsed postings; labels ${evidence.verdict}`,
  } });
  await record('validate', { robotsVerdict: robots.verdict, robotsCheckedAt: robotsCheckedAt.toISOString(), parsed: jobs.length, scopeVerdict: evidence.verdict, labels: evidence.labels.length });

  // ── certify ─────────────────────────────────────────────────────────────────
  const artifact = readFileSync(dossier.evidenceFile);
  const artifactHash = createHash('sha256').update(artifact).digest('hex');
  const source = await p.source.findUniqueOrThrow({ where: { key: dossier.key } });
  const { recordSourceIdentityReview, sourceIdentityHash, sourceSubjectKey } = await import('../../src/connectors/sourceIdentity.js');
  const certifyResult = await recordSourceIdentityReview(p as any, {
    sourceKey: dossier.key, tenantKey: source.tenantKey, subjectKey: sourceSubjectKey(source), sourceHash: sourceIdentityHash(source),
    verdict: 'VERIFIED', method: 'OFFICIAL_LINK', officialDomain: dossier.officialDomain, proofUrl: dossier.proofUrl,
    portalUrl: dossier.portalUrl, portalScope: dossier.portalScope, artifactHash,
    statement: `${dossier.statement} Native labels read at validation: ${evidence.labels.map((l: any) => `${l.label} ×${l.n} [${l.class}]`).join(', ')} → ${evidence.verdict}.`,
    reviewer: 'P3 onboarding demonstration on clone (LOT 4, 2026-09-11)', checkedAt: new Date().toISOString(),
  } as any, artifact, true);
  await record('certify', { artifactHash, written: !!certifyResult });

  // ── promote ─────────────────────────────────────────────────────────────────
  const promoted = await record('promote', await promoteSource(p as any, dossier.key));
  if (promoted.status !== 'ACTIVE') throw new Error(`${dossier.key}: promotion did not end ACTIVE (${promoted.status})`);

  // ── ingest ──────────────────────────────────────────────────────────────────
  process.env.INGEST_ONLY_KEYS = dossier.key;
  process.env.EGRESS_PROBE = '0';
  const { ingestAllBySource } = await import('../../src/pipeline/ingestOrchestrator.js');
  const run = await ingestAllBySource(p as any);
  const rows: any[] = await p.$queryRaw`
    SELECT js."externalId", js.id AS job_source_id, j.id AS job_id, j.title, j."postedAt", j.location, j."firstSeenAt"
    FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
    WHERE js."sourceKey" = ${dossier.key} AND js."isActive" AND j."isActive" ORDER BY js."externalId"`;
  await record('ingest', { run, jobs: rows.length });

  writeFileSync(`${OUT}/onboard-${dossier.key}.json`, JSON.stringify({ at: new Date().toISOString(), database: db, dossier: dossier.key, steps, rows }, null, 1));
  console.log(JSON.stringify({ dossier: dossier.key, transitions: steps.map((s) => `${s.step}:${s.after.status ?? '—'}/${s.after.certification}`), jobs: rows.length }, null, 1));
} finally { await p.$disconnect(); }
