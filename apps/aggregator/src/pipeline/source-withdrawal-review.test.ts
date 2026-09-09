import '../test/setup-integration.js';
import { randomUUID, createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { sourceIdentityHash } from '../connectors/sourceIdentity.js';
import { planReviewedSourceWithdrawal } from '../remediation/sourceWithdrawal.js';
import { applyRepairPlan, digest } from '../remediation/plan.js';
const prisma = new PrismaClient();
async function wipe() { await prisma.job.deleteMany(); await prisma.company.deleteMany(); await prisma.source.deleteMany({ where: { key: 'template-fixture' } }); }
beforeEach(wipe); afterAll(async () => { await wipe(); await prisma.$disconnect(); });
async function fixture() {
  const company = await prisma.company.create({ data: { name: 'Brand', canonicalKey: 'BRAND', kind: 'BRAND', fashionjobsUrl: 'resolved:BRAND' } });
  const source = await prisma.source.create({ data: { key: 'template-fixture', maison: 'Brand', kind: 'teamtailor', config: { origin: 'https://brand.teamtailor.com' }, tenantKey: 'teamtailor:brand.teamtailor.com', tier: 'ATS_OFFICIAL', status: 'ACTIVE' } });
  const create = (id: string, active: boolean) => prisma.job.create({ data: { companyId: company.id, externalId: id, fingerprint: `BRAND|${id}`, source: 'TEAMTAILOR', title: 'Sales', url: `https://brand.teamtailor.com/jobs/${id}`, isActive: active, closedAt: active ? null : new Date('2026-09-01'), sources: { create: { sourceKey: source.key, externalId: id, url: `https://brand.teamtailor.com/jobs/${id}`, sourceTier: 'ATS_OFFICIAL', isActive: active, raw: { original: id } } }, events: { create: { type: 'OPENED' } } } });
  const active = await create('1', true), closed = await create('2', false);
  const statement = 'The official career page points to a different active portal; the old board contains native demonstration text, reviewed as invalid job content.';
  const spec = { batchId: randomUUID(), reviewer: 'integration', reviewedAt: new Date().toISOString(), statement, sources: [{ sourceKey: source.key, expectedSourceHash: sourceIdentityHash(source), statement, evidence: [{ url: 'https://example.com/careers', artifactText: statement, sha256: createHash('sha256').update(statement).digest('hex'), explanation: statement }] }] };
  return { active, closed, source, company, spec };
}
it('retires reviewed invalid content while preserving employer identity, RAW and real closure history', async () => {
  const { active, closed, company, spec } = await fixture(); const plan = await planReviewedSourceWithdrawal(prisma, spec);
  expect(plan.operations.filter(o => o.entity === 'Job')).toHaveLength(1);
  await applyRepairPlan(prisma, plan, digest(plan), 'test');
  const after = await prisma.job.findUniqueOrThrow({ where: { id: active.id }, include: { sources: true, events: true } });
  expect(after).toMatchObject({ companyId: company.id, isActive: false, closedAt: null, withdrawalReason: 'SOURCE_RETIRED', firstSeenAt: active.firstSeenAt });
  expect(after.sources[0]).toMatchObject({ isActive: false, raw: { original: '1' } }); expect(after.events.some(e => e.type === 'OPENED')).toBe(true);
  expect(after.events.some(e => e.type === 'CLOSED')).toBe(false);
  expect(after.events.filter(e => e.type === 'WITHDRAWN')).toHaveLength(1);
  expect(await prisma.job.findUniqueOrThrow({ where: { id: closed.id } })).toMatchObject({ closedAt: closed.closedAt, withdrawnAt: null });
  expect(await applyRepairPlan(prisma, plan, digest(plan), 'test')).toMatchObject({ alreadyApplied: true, written: 0 });
});
it('refuses competing live evidence and stale source/row changes', async () => {
  const { active, source, spec } = await fixture();
  await prisma.jobSource.create({ data: { jobId: active.id, sourceKey: 'official', externalId: '1', url: 'https://example.com/job/1', sourceTier: 'EMPLOYER_DIRECT' } });
  await expect(planReviewedSourceWithdrawal(prisma, spec)).rejects.toThrow('Competing active source');
  await prisma.jobSource.deleteMany({ where: { sourceKey: 'official' } });
  const plan = await planReviewedSourceWithdrawal(prisma, spec);
  await prisma.source.update({ where: { id: source.id }, data: { note: 'changed since audit' } });
  await expect(applyRepairPlan(prisma, plan, digest(plan), 'test')).rejects.toThrow('Stale plan');
  expect((await prisma.job.findUniqueOrThrow({ where: { id: active.id } })).isActive).toBe(true);
  spec.sources[0].evidence[0].artifactText = 'changed';
  await expect(planReviewedSourceWithdrawal(prisma, spec)).rejects.toThrow('Invalid source withdrawal evidence');
});
