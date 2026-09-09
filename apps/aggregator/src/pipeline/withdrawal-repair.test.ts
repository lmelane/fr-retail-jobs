import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { beforeEach, afterAll, it, expect } from 'vitest';
import { applyRepairPlan, digest, json, type RepairPlan } from '../remediation/plan.js';
import { planAdministrativeWithdrawals } from '../remediation/withdrawal.js';

const db = new PrismaClient();
beforeEach(async () => { await db.job.deleteMany(); await db.company.deleteMany(); });
afterAll(async () => { await db.job.deleteMany(); await db.company.deleteMany(); await db.$disconnect(); });

async function witness() {
  const key = `withdrawal-${randomUUID()}`;
  const company = await db.company.create({ data: { name: 'Legacy homonym', canonicalKey: key, fashionjobsUrl: `resolved:${key}` } });
  await db.source.create({ data: { key, maison: company.name, kind: 'lever', config: {}, tenantKey: key, status: 'RETIRED', tier: 'ATS_OFFICIAL' } });
  const job = await db.job.create({ data: { companyId: company.id, externalId: key, source: 'LEVER', title: 'Archived role', url: 'https://example.com/job', fingerprint: key, raw: { proof: 'original' },
    sources: { create: { sourceKey: key, externalId: key, sourceTier: 'ATS_OFFICIAL', url: 'https://example.com/job', isActive: false, raw: { proof: 'original' } } },
  }, omit: { searchText: true } });
  const legacy: RepairPlan = { version: 1, batchId: randomUUID(), finding: randomUUID(), createdAt: new Date().toISOString(), sourceKeys: [key], companyIds: [company.id], evidence: { decision: 'Withdraw out-of-scope source' }, invariants: ['lifecycle'],
    operations: [{ entity: 'Job', id: job.id, before: json(job), patch: { isActive: false, closedAt: new Date().toISOString() }, reason: 'Administrative exclusion, no employer closure' }] };
  await applyRepairPlan(db, legacy, digest(legacy), 'test');
  return { job, legacy, spec: { batchId: randomUUID(), originalFinding: legacy.finding, reason: 'OUT_OF_SCOPE' } };
}

it('corrects the real legacy receipt shape, keeps visibility/RAW/history, and replays without another correction', async () => {
  const { job, legacy, spec } = await witness();
  const plan = await planAdministrativeWithdrawals(db, spec);
  expect(plan.operations).toHaveLength(1);
  const original = await db.dataCorrection.findFirstOrThrow({ where: { batchId: legacy.batchId } });
  expect(await applyRepairPlan(db, plan, digest(plan), 'test')).toMatchObject({ written: 1, lifecycleViolations: 0 });
  expect(await applyRepairPlan(db, plan, digest(plan), 'test')).toMatchObject({ written: 0, alreadyApplied: true });
  expect(await db.dataCorrection.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
  expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ isActive: false, closedAt: null, withdrawalReason: 'OUT_OF_SCOPE', firstSeenAt: job.firstSeenAt, raw: job.raw });
  expect(await db.jobEvent.count({ where: { jobId: job.id, type: 'CLOSED' } })).toBe(0);
  expect((await planAdministrativeWithdrawals(db, spec)).operations).toHaveLength(0);
});

it('refuses to replace an employer closure that followed the administrative decision', async () => {
  const { job, spec } = await witness();
  await db.jobEvent.create({ data: { jobId: job.id, type: 'CLOSED', at: new Date(Date.now() + 1000) } });
  await expect(planAdministrativeWithdrawals(db, spec)).rejects.toThrow('Later employer closure');
  expect(await db.dataCorrection.count({ where: { batchId: spec.batchId } })).toBe(0);
});
