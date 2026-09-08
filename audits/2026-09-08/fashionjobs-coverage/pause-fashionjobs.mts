/** Prepare or verify a reversible, journaled source pause. Never changes job data. */
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { digest, json, type RepairPlan } from '../../../apps/aggregator/src/remediation/plan.js';

const db = new PrismaClient();
const root = 'backups/remediation-20260908';
const action = process.argv[2];
try {
  const observed = await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const source = await tx.source.findUniqueOrThrow({ where: { key: 'fashionjobs' } });
    const representations = await tx.jobSource.findMany({ where: { sourceKey: source.key }, orderBy: { id: 'asc' } });
    const jobs = await tx.job.findMany({ where: { sources: { some: { sourceKey: source.key } } }, omit: { searchText: true }, orderBy: { id: 'asc' } });
    return json({ at: new Date().toISOString(), source, sourceCount: await tx.source.count({ where: { status: 'ACTIVE' } }),
      jobs: jobs.length, activeJobs: jobs.filter(j => j.isActive).length, representations: representations.length,
      jobsHash: digest(jobs), representationsHash: digest(representations),
      correctionCount: await tx.dataCorrection.count({ where: { batchId: '20260908-FASHIONJOBS-DISCOVERY-ONLY-v1' } }) });
  }, { timeout: 60000 });
  if (action === 'plan') {
    if (observed.source.status !== 'ACTIVE') throw new Error('Expected active source before pause');
    const reason = 'User decision 2026-09-08: FashionJobs is only employer-discovery and aggregate-count evidence; stop collecting its job offers. Preserve historical jobs, RAW and events. Recruit directly from official employer sources.';
    const plan: RepairPlan = { version: 1, batchId: '20260908-FASHIONJOBS-DISCOVERY-ONLY-v1', finding: 'fashionjobs-discovery-only',
      createdAt: observed.at, sourceKeys: ['fashionjobs'], companyIds: [],
      operations: [{ entity: 'Source', id: observed.source.id, before: observed.source, patch: { status: 'PAUSED', note: [observed.source.note, reason].filter(Boolean).join('\n') }, reason }],
      evidence: { decision: reason, jobsBefore: observed.jobs, activeJobsBefore: observed.activeJobs, jobsHashBefore: observed.jobsHash, representationsHashBefore: observed.representationsHash },
      invariants: ['oracle', 'lifecycle', 'smcp'] };
    writeFileSync(`${root}/fashionjobs-pause-plan.json`, JSON.stringify(plan, null, 2), { mode: 0o600 });
    writeFileSync(`${root}/fashionjobs-pause-before.json`, JSON.stringify(observed, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ batchId: plan.batchId, hash: digest(plan), operations: 1, before: observed.source.status, after: 'PAUSED', jobs: observed.jobs, activeJobs: observed.activeJobs, representations: observed.representations }));
  } else if (action === 'verify') {
    const before = JSON.parse(readFileSync(`${root}/fashionjobs-pause-before.json`, 'utf8'));
    if (observed.source.status !== 'PAUSED' || observed.jobsHash !== before.jobsHash || observed.representationsHash !== before.representationsHash || observed.correctionCount !== 1) throw new Error('Pause or full-row job preservation check failed');
    console.log(JSON.stringify({ ...observed, source: { key: observed.source.key, status: observed.source.status }, jobsPreservedExactly: true, representationsPreservedExactly: true }, null, 2));
  } else throw new Error('Use plan or verify');
} finally { await db.$disconnect(); }
