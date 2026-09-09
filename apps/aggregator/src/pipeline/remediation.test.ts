import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { beforeEach, afterAll, expect, it } from 'vitest';
import { applyRepairPlan, digest, json, type RepairPlan } from '../remediation/plan.js';

const prisma = new PrismaClient();
beforeEach(async () => { await prisma.job.deleteMany(); await prisma.company.deleteMany(); });
afterAll(async () => { await prisma.job.deleteMany(); await prisma.company.deleteMany(); await prisma.$disconnect(); });
async function witness() {
  const company = await prisma.company.create({ data: { name: 'Tiffany & Co.', canonicalKey: 'TIFFANY', fashionjobsUrl: `witness:${randomUUID()}` } });
  const job = await prisma.job.create({ data: { companyId: company.id, externalId: '63763', source: 'ORACLE_HCM', title: 'CDD Client Advisor - Paris', url: 'https://eljs.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/63763', countryCode: 'AU', fingerprint: 'witness',
    sources: { create: { sourceKey: 'tiffany-oracle', sourceTier: 'EMPLOYER_DIRECT', externalId: '63763', url: 'https://eljs.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/63763' } },
    events: { create: { type: 'OPENED' } },
  }, omit: { searchText: true } });
  const plan: RepairPlan = { version: 1, batchId: randomUUID(), finding: 'P0_ORACLE_IDENTITY', createdAt: new Date().toISOString(), sourceKeys: ['tiffany-oracle'], companyIds: [company.id], evidence: { witness: 'Production requisition 63763' }, invariants: ['lifecycle'], operations: [{ entity: 'Job', id: job.id, before: json(job), patch: { countryCode: 'FR', isFrance: true }, reason: 'Official requisition country' }] };
  return { job, plan };
}

it('preserves the ID, first observation and old history; records immutable before/after; rerun is a no-op', async () => {
  const { job, plan } = await witness();
  expect((await applyRepairPlan(prisma, plan, digest(plan), 'test')).written).toBe(1);
  expect((await applyRepairPlan(prisma, plan, digest(plan), 'test')).written).toBe(0);
  const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  expect(after.firstSeenAt).toEqual(job.firstSeenAt);
  expect(after.countryCode).toBe('FR');
  expect(await prisma.jobEvent.count({ where: { jobId: job.id, type: 'OPENED' } })).toBe(1);
  const record = await prisma.dataCorrection.findFirstOrThrow({ where: { batchId: plan.batchId } });
  expect(record.before).toMatchObject({ countryCode: 'AU' });
  expect(record.after).toMatchObject({ countryCode: 'FR' });
  await expect(prisma.dataCorrection.delete({ where: { id: record.id } })).rejects.toThrow('append-only');
});

it('rejects stale evidence and preserves concurrent changes', async () => {
  const { job, plan } = await witness();
  await prisma.job.update({ where: { id: job.id }, data: { title: 'Official updated title' } });
  await expect(applyRepairPlan(prisma, plan, digest(plan), 'test')).rejects.toThrow('Stale plan');
  expect(await prisma.dataCorrection.count({ where: { batchId: plan.batchId } })).toBe(0);
  expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).countryCode).toBe('AU');
});

it('rolls back the entire batch when its resulting state violates lifecycle invariants', async () => {
  const { job, plan } = await witness();
  plan.operations[0].patch.closedAt = new Date().toISOString();
  await expect(applyRepairPlan(prisma, plan, digest(plan), 'test')).rejects.toThrow('Lifecycle invariant');
  expect(await prisma.dataCorrection.count({ where: { batchId: plan.batchId } })).toBe(0);
  const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  expect(after.countryCode).toBe('AU');
  expect(after.closedAt).toBeNull();
});

it('rejects a France filter repair if an untouched active row still contradicts its canonical country', async () => {
  const { job, plan } = await witness();
  const other = await prisma.job.create({ data: {
    companyId: job.companyId, externalId: 'untouched-france', source: 'ORACLE_HCM',
    title: 'Untouched France witness', url: 'https://example.com/untouched-france',
    countryCode: 'FR', isFrance: false, fingerprint: 'untouched-france',
  } });
  plan.invariants = ['france-filter'];
  await expect(applyRepairPlan(prisma, plan, digest(plan), 'test')).rejects.toThrow(other.id);
  expect(await prisma.dataCorrection.count({ where: { batchId: plan.batchId } })).toBe(0);
  expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).countryCode).toBe('AU');
  await prisma.job.update({ where: { id: other.id }, data: { isFrance: true } });
  expect(await applyRepairPlan(prisma, plan, digest(plan), 'test')).toMatchObject({ written: 1, franceFilterContradictions: 0 });
});
