import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
const certifiedScopes = new Map<string, 'SINGLE_BRAND' | 'MULTI_BRAND'>();
vi.mock('../connectors/sourceIdentity.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../connectors/sourceIdentity.js')>()), certifiedPortalScope: async (_p: unknown, key: string) => certifiedScopes.get(key) ?? null }));
import { resolveEmployer, recordEmployerObservation } from '../identity/resolve.js';
import { EmployerIdentityReviewRequired } from '../identity/errors.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import { resolveCompany } from '../normalize/company.js';
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

it('keeps the house even when no earlier observation exists for the posting (the gate predates most sources)', async () => {
  const { group, house, base } = await fixture();
  await prisma.employerObservation.deleteMany({ where: { sourceKey: SOURCE, externalId: base.externalId } }).catch(() => undefined); // append-only: may be refused, the case below works either way
  const asGroup = { ...base, externalId: `${base.externalId}-fresh`, company: group.name, companyId: group.canonicalKey, rawEmployerName: group.name, employerLabelOrigin: 'ADAPTER_COMPANY' };
  await prisma.jobSource.create({ data: { jobId: (await prisma.job.findFirstOrThrow({ where: { sources: { some: { externalId: base.externalId } } } })).id, sourceKey: SOURCE, externalId: asGroup.externalId, url: `https://careers.example.com/job/${asGroup.externalId}`, sourceTier: 'GROUP_OFFICIAL', isActive: true, firstSeenAt: new Date(), lastSeenAt: new Date(), raw: {} } });
  const resolution = await prisma.$transaction(tx => resolveEmployer(tx, asGroup));
  expect(resolution.company?.id).toBe(house.id); expect(resolution.rule).toBe('GROUP_LABEL_KEPT_HOUSE');
});


/** Workday logo alt, 2026-09-10: the previous observation read "UGG Logo" (the image's word), the posting was held by UGG all along.
 * The cleaned spelling equals the holder's canonical name: a convergence, not a new identity. Any other new spelling is still refused. */
it('accepts a new spelling that is exactly the canonical name of the employer already holding the posting', async () => {
  const { house, base } = await fixture();
  const withWord = { ...base, company: house.name, companyId: house.canonicalKey, rawEmployerName: `${house.name} Logo`, employerLabelOrigin: 'detail.jobPostingInfo.logoImage.alt:LOGO_ALT' };
  await recordEmployerObservation(prisma, withWord, house.id, { company: house, rule: 'LEGACY_UNREVIEWED', rawEmployerName: withWord.rawEmployerName, normalizedEmployerName: normalizedEmployerName(withWord.rawEmployerName) });
  const cleaned = { ...withWord, rawEmployerName: house.name, employerLabelOrigin: 'detail.jobPostingInfo.logoImage.alt:LOGO_ALT_WORD_REMOVED' };
  const resolution = await prisma.$transaction(tx => resolveEmployer(tx, cleaned));
  expect(resolution.company?.id).toBe(house.id); expect(resolution.rule).toBe('LEGACY_UNREVIEWED');
  await expect(prisma.$transaction(tx => resolveEmployer(tx, { ...withWord, rawEmployerName: `${house.name} Boutique` }))).rejects.toBeInstanceOf(EmployerIdentityReviewRequired);
});

/** Mango, 2026-09-10: a portal certified SINGLE_BRAND publishes only entities of its owner — a new legal-entity label is the owner, not a new employer.
 * The certification is mocked (SourceIdentityReview is immutable by trigger: a persisted fixture would block the other files' wipe). */
it('credits any native label of a certified SINGLE_BRAND portal to the portal owner, and keeps the raw label in the observation', async () => {
  const k = randomUUID().slice(0, 8).toUpperCase(), key = `gate-single-${k.toLowerCase()}`;
  const owner = await prisma.company.create({ data: { name: `Mango Fixture ${k}`, canonicalKey: `MANGO_FIXTURE_${k}`, kind: 'BRAND', fashionjobsUrl: `resolved:MANGO_FIXTURE_${k}` } });
  const candidate = { sourceKey: key, externalId: `p-${k}`, title: 'Sales Assistant', url: `https://${key}.wd3.myworkdayjobs.com/Careers/job/x`, source: 'WORKDAY', company: owner.name, companyId: owner.canonicalKey, rawEmployerName: `MANGO NY ${k} LLC`, employerLabelOrigin: 'HIRING_ORGANIZATION_LABEL' } as any;
  certifiedScopes.set(key, 'SINGLE_BRAND');
  const resolution = await prisma.$transaction(tx => resolveEmployer(tx, candidate));
  expect(resolution.company?.id).toBe(owner.id); expect(resolution.rule).toBe('CERTIFIED_SINGLE_BRAND_PORTAL'); expect(resolution.rawEmployerName).toBe(`MANGO NY ${k} LLC`);
  // Without the certification (MULTI_BRAND or none), the same new label is still an identity change to review.
  certifiedScopes.set(key, 'MULTI_BRAND');
  await expect(prisma.$transaction(tx => resolveEmployer(tx, candidate))).rejects.toBeInstanceOf(EmployerIdentityReviewRequired);
  certifiedScopes.delete(key);
  await expect(prisma.$transaction(tx => resolveEmployer(tx, candidate))).rejects.toBeInstanceOf(EmployerIdentityReviewRequired);
  // A native label that IS a known distinct employer contradicts the certified perimeter: review, never absorbed by the owner.
  const other = await prisma.company.create({ data: { name: `Kate Fixture ${k}`, canonicalKey: `KATE_FIXTURE_${k}`, kind: 'BRAND', fashionjobsUrl: `resolved:KATE_FIXTURE_${k}` } });
  certifiedScopes.set(key, 'SINGLE_BRAND');
  await expect(prisma.$transaction(tx => resolveEmployer(tx, { ...candidate, externalId: `p-${k}-2`, rawEmployerName: other.name }))).rejects.toBeInstanceOf(EmployerIdentityReviewRequired);
  // …while a label whose company was MERGED into the owner (a legal entity) is still the owner.
  const mergeReview = await prisma.employerIdentityReview.create({ data: { id: randomUUID(), statement: 'fixture: the legal entity is merged into the owner', evidence: [], planHash: 'fixture', reviewedBy: 'integration', reviewedAt: new Date() } });
  const entity = await prisma.company.create({ data: { name: `Mango Fixture ${k} NY LLC`, canonicalKey: `MANGO_FIXTURE_${k}_NY_LLC`, kind: 'BRAND', fashionjobsUrl: `resolved:MANGO_FIXTURE_${k}_NY_LLC`, mergedIntoId: owner.id, identityReviewId: mergeReview.id } });
  const merged = await prisma.$transaction(tx => resolveEmployer(tx, { ...candidate, externalId: `p-${k}-3`, rawEmployerName: entity.name }));
  expect(merged.company?.id).toBe(owner.id); expect(merged.rule).toBe('CERTIFIED_SINGLE_BRAND_PORTAL');
  certifiedScopes.delete(key);
});

/** Ysé, 2026-09-10: Teamtailor labels the posting with the legal entity, the candidate's companyId derives from that label, and the certified owner lookup missed → a duplicate employer "L'IMPERTINENTE - Ysé" beside "Ysé". */
it('on a certified SINGLE_BRAND portal the owner is the catalogued Maison, never the label: found under its canonical key, or created there', async () => {
  const k = randomUUID().slice(0, 8).toUpperCase(), key = `gate-cat-${k.toLowerCase()}`, keyNew = `gate-new-${k.toLowerCase()}`;
  await prisma.source.createMany({ data: [
    { key, maison: `Yse Fixture ${k}`, kind: 'teamtailor', config: { origin: `https://${key}.teamtailor.com` }, tier: 'EMPLOYER_DIRECT', tenantKey: `teamtailor:${key}.teamtailor.com`, status: 'ACTIVE' },
    { key: keyNew, maison: `Prairie Fixture ${k}`, kind: 'teamtailor', config: { origin: `https://${keyNew}.teamtailor.com` }, tier: 'EMPLOYER_DIRECT', tenantKey: `teamtailor:${keyNew}.teamtailor.com`, status: 'ACTIVE' },
  ] });
  try {
    const owner = await prisma.company.create({ data: { name: `Yse Fixture ${k}`, canonicalKey: `YSE_FIXTURE_${k}`, kind: 'BRAND', fashionjobsUrl: `resolved:YSE_FIXTURE_${k}` } });
    const label = `L'IMPERTINENTE - Yse Fixture ${k}`;
    const candidate = { sourceKey: key, externalId: `p-${k}`, title: 'Conseillère de vente', url: `https://${key}.teamtailor.com/jobs/1`, source: 'TEAMTAILOR', company: resolveCompany(label).displayName, companyId: resolveCompany(label).companyId, rawEmployerName: label, employerLabelOrigin: 'jsonld:HIRING_ORGANIZATION' } as any;
    expect(candidate.companyId).not.toBe(owner.canonicalKey); // the label-derived key is NOT the owner's key — that is the whole point
    certifiedScopes.set(key, 'SINGLE_BRAND');
    const found = await prisma.$transaction(tx => resolveEmployer(tx, candidate));
    expect(found.company?.id).toBe(owner.id); expect(found.rule).toBe('CERTIFIED_SINGLE_BRAND_PORTAL'); expect(found.rawEmployerName).toBe(label);
    // New actor: the owner does not exist yet → created under the canonical key of the catalogued Maison, with its name — never a source-scoped key.
    const labelNew = `Prairie Holding ${k} - Prairie Fixture ${k}`;
    certifiedScopes.set(keyNew, 'SINGLE_BRAND');
    const created = await prisma.$transaction(tx => resolveEmployer(tx, { ...candidate, sourceKey: keyNew, externalId: `p-${k}-new`, company: resolveCompany(labelNew).displayName, companyId: resolveCompany(labelNew).companyId, rawEmployerName: labelNew }));
    expect(created.company).toBeNull(); expect(created.rule).toBe('CERTIFIED_SINGLE_BRAND_PORTAL');
    expect(created.newKey).toBe(`PRAIRIE_FIXTURE_${k}`); expect(created.newName).toBe(`Prairie Fixture ${k}`);
    // Without the certification the same label is still an identity change to review (unchanged contract).
    certifiedScopes.delete(keyNew);
    await expect(prisma.$transaction(tx => resolveEmployer(tx, { ...candidate, sourceKey: keyNew, externalId: `p-${k}-new2`, company: resolveCompany(labelNew).displayName, companyId: resolveCompany(labelNew).companyId, rawEmployerName: labelNew }))).resolves.toMatchObject({ rule: 'LEGACY_UNREVIEWED', newKey: expect.stringMatching(/^SOURCE_/) });
  } finally {
    certifiedScopes.delete(key); certifiedScopes.delete(keyNew);
    await prisma.source.deleteMany({ where: { key: { in: [key, keyNew] } } });
  }
});
