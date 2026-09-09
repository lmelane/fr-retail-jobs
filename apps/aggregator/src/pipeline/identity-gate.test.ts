import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { resolveEmployer, recordEmployerObservation } from '../identity/resolve.js';
import { EmployerIdentityReviewRequired } from '../identity/errors.js';
const prisma = new PrismaClient();
const SOURCE = 'gate-fixture';
// EmployerObservation is append-only (database trigger) and references companies: every fixture entity gets a fresh key
// and nothing is deleted but the fixture's own jobs.
beforeEach(async () => { await prisma.job.deleteMany({ where: { sources: { some: { sourceKey: SOURCE } } } }); });
afterAll(async () => { await prisma.job.deleteMany({ where: { sources: { some: { sourceKey: SOURCE } } } }); await prisma.$disconnect(); });

/** Kering, 2026-09-09: 6 postings came back labelled "Kering" because the feed omitted the house that a previous response had attested. */
async function fixture() {
  const id = `p-${randomUUID()}`, k = randomUUID().slice(0, 8).toUpperCase();
  const group = await prisma.company.create({ data: { name: `Actual Group ${k}`, canonicalKey: `ACTUAL_GROUP_${k}`, kind: 'GROUP', fashionjobsUrl: `resolved:ACTUAL_GROUP_${k}` } });
  const review = await prisma.employerIdentityReview.create({ data: { id: randomUUID(), statement: 'fixture: the house belongs to the group', evidence: [], planHash: 'fixture', reviewedBy: 'integration', reviewedAt: new Date() } });
  const house = await prisma.company.create({ data: { name: `Saint House ${k}`, canonicalKey: `SAINT_HOUSE_${k}`, kind: 'MAISON', fashionjobsUrl: `resolved:SAINT_HOUSE_${k}`, parentGroup: `Actual Group ${k}`, parentGroupId: group.id, identityReviewId: review.id } });
  const other = await prisma.company.create({ data: { name: `Other Brand ${k}`, canonicalKey: `OTHER_BRAND_${k}`, kind: 'BRAND', fashionjobsUrl: `resolved:OTHER_BRAND_${k}` } });
  const job = await prisma.job.create({ data: { companyId: house.id, externalId: id, source: 'EIGHTFOLD', title: 'Client Advisor', url: `https://careers.example.com/job/${id}`, fingerprint: `SAINT_HOUSE_${k}|${id}`, clusterKey: `SAINT_HOUSE_${k}|${id}`, isActive: true, firstSeenAt: new Date(), lastSeenAt: new Date(),
    sources: { create: { sourceKey: SOURCE, externalId: id, url: `https://careers.example.com/job/${id}`, sourceTier: 'GROUP_OFFICIAL', isActive: true, firstSeenAt: new Date(), lastSeenAt: new Date(), raw: {} } } } });
  const base = { sourceKey: SOURCE, externalId: id, title: 'Client Advisor', url: `https://careers.example.com/job/${id}`, source: 'EIGHTFOLD' } as any;
  // Previous attested observation: the house.
  await recordEmployerObservation(prisma, { ...base, company: house.name, companyId: house.canonicalKey, rawEmployerName: house.name, employerLabelOrigin: 'ADAPTER_COMPANY' }, house.id, { company: house, rule: 'LEGACY_UNREVIEWED', rawEmployerName: house.name, normalizedEmployerName: house.name.toLowerCase() });
  return { group, house, other, job, base, k };
}

it('keeps the attested house when a later response only carries the group label, and records the omission', async () => {
  const { group, house, base } = await fixture();
  const asGroup = { ...base, company: group.name, companyId: group.canonicalKey, rawEmployerName: group.name, employerLabelOrigin: 'ADAPTER_COMPANY' };
  const resolution = await prisma.$transaction(tx => resolveEmployer(tx, asGroup));
  expect(resolution.company?.id).toBe(house.id); expect(resolution.rule).toBe('GROUP_LABEL_KEPT_HOUSE'); expect(resolution.rawEmployerName).toBe(group.name);
  await recordEmployerObservation(prisma, asGroup, house.id, resolution);
  const observations = await prisma.employerObservation.findMany({ where: { sourceKey: SOURCE, externalId: base.externalId }, orderBy: { observedAt: 'asc' } });
  expect(observations.map(o => [o.rawEmployerName, o.rule, o.canonicalEmployerId])).toEqual([[house.name, 'LEGACY_UNREVIEWED', house.id], [group.name, 'GROUP_LABEL_KEPT_HOUSE', house.id]]);
});
it('still refuses a different brand label, and a group label when no group is recorded for the house', async () => {
  const { group, house, other, base } = await fixture();
  await expect(prisma.$transaction(tx => resolveEmployer(tx, { ...base, company: other.name, companyId: other.canonicalKey, rawEmployerName: other.name, employerLabelOrigin: 'ADAPTER_COMPANY' }))).rejects.toBeInstanceOf(EmployerIdentityReviewRequired);
  await prisma.company.update({ where: { id: house.id }, data: { parentGroup: null, parentGroupId: null } });
  await expect(prisma.$transaction(tx => resolveEmployer(tx, { ...base, company: group.name, companyId: group.canonicalKey, rawEmployerName: group.name, employerLabelOrigin: 'ADAPTER_COMPANY' }))).rejects.toBeInstanceOf(EmployerIdentityReviewRequired);
});
