import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, expect, it } from 'vitest';
import { applyRepairPlan, digest } from '../remediation/plan.js';
import { planAnchorDuplicates } from '../remediation/anchorDuplicates.js';

/**
 * D-522 §6, Lumentee (03/10/2026) : une offre publiée une fois par ancre de sa page (#roles, #main, #culture, #). Le plan
 * retire les copies nommées, garde la représentation à la vraie adresse, la source et la Société.
 */
const db = new PrismaClient(); const keys: string[] = []; const companies: string[] = [];
afterAll(async () => {
  await db.jobSource.deleteMany({ where: { sourceKey: { in: keys } } });
  await db.job.deleteMany({ where: { companyId: { in: companies } } });
  await db.$disconnect();
});
const PAGE = 'https://lumentee.com/careers/';
const ANCHORS = ['#roles', '#main', '#culture', '#'].map((a) => `${PAGE}${a}`);

async function lumentee() {
  const key = `lumentee-${randomUUID()}`; keys.push(key);
  const company = await db.company.create({ data: { name: 'Lumentee', canonicalKey: key, fashionjobsUrl: `resolved:${key}`, domain: 'lumentee.com' } });
  companies.push(company.id);
  await db.source.create({ data: { key, maison: 'Lumentee', kind: 'generic-listing', config: { startUrl: PAGE }, tenantKey: `generic:${key}`, status: 'ACTIVE', tier: 'EMPLOYER_DIRECT' } });
  const offer = (url: string) => db.job.create({ data: { companyId: company.id, externalId: `${key}${url}`, source: 'GENERIC_JSONLD', title: 'D2C Growth Marketer', url,
    sources: { create: { sourceKey: key, externalId: `${key}${url}`, sourceTier: 'EMPLOYER_DIRECT', url, title: 'D2C Growth Marketer' } } }, omit: { searchText: true } });
  const kept = await offer(PAGE);
  const copies = await Promise.all(ANCHORS.map(offer));
  return { key, company, kept, copies };
}
const spec = (key: string, duplicateUrls = ANCHORS) => ({ batchId: randomUUID(), sourceKey: key, keepUrl: PAGE, duplicateUrls,
  statement: 'une seule offre relue par chacune des ancres de la page, publiée cinq fois' });

it('retire les quatre copies, garde la vraie représentation, et se rejoue sans nouvelle correction', async () => {
  const { key, company, kept, copies } = await lumentee();
  expect(await db.jobSource.count({ where: { sourceKey: key, isActive: true } })).toBe(5);
  const plan = await planAnchorDuplicates(db, spec(key));
  expect(plan.operations.filter((op) => op.entity === 'Job').map((op) => op.id).sort()).toEqual(copies.map((job) => job.id).sort());
  expect(await applyRepairPlan(db, plan, digest(plan), 'test')).toMatchObject({ written: 8, lifecycleViolations: 0 });
  for (const job of copies) {
    expect(await db.job.findUniqueOrThrow({ where: { id: job.id }, omit: { searchText: true } })).toMatchObject({ isActive: false, closedAt: null, withdrawalReason: 'PUBLICATION_UNVERIFIED' });
    expect(await db.jobEvent.count({ where: { jobId: job.id, type: 'CLOSED' } })).toBe(0);
  }
  expect(await db.job.findUniqueOrThrow({ where: { id: kept.id }, omit: { searchText: true } })).toMatchObject({ isActive: true, withdrawnAt: null });
  expect(await db.jobSource.count({ where: { sourceKey: key, isActive: true } })).toBe(1);
  expect(await db.source.findUniqueOrThrow({ where: { key } })).toMatchObject({ status: 'ACTIVE' });
  expect(await db.company.findUniqueOrThrow({ where: { id: company.id } })).toMatchObject({ name: 'Lumentee' });
  expect(await applyRepairPlan(db, plan, digest(plan), 'test')).toMatchObject({ alreadyApplied: true, written: 0 });
  await expect(planAnchorDuplicates(db, spec(key))).rejects.toThrow('Reviewed count changed: 0');
});

it('refuse une copie dont l’offre est aussi portée par une autre source', async () => {
  const { key, copies } = await lumentee();
  const other = `other-${randomUUID()}`; keys.push(other);
  await db.jobSource.create({ data: { jobId: copies[0].id, sourceKey: other, externalId: 'x', sourceTier: 'ATS_OFFICIAL', url: 'https://example.com/x' } });
  await expect(planAnchorDuplicates(db, spec(key))).rejects.toThrow('Other active evidence');
});
