import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveEmployer, recordEmployerObservation } from '../identity/resolve.js';
import { EmployerIdentityReviewRequired } from '../identity/errors.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import { resolveCompany } from '../normalize/company.js';
import { certifiedPortalIdentity, recordSourceIdentityReview, sourceIdentityHash } from '../connectors/sourceIdentity.js';
import { captureIdentityFixture } from '../test/sourceIdentityFixture.js';
import { toCandidate } from './ingest.js';
import { employerFromCertifiedScope } from '../identity/portalEmployer.js';
import { employerAliasKey } from '../normalize/employerName.js';
const prisma = new PrismaClient();
const SOURCE = 'gate-fixture';
const portalKeys: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
// EmployerObservation is append-only (database trigger) and references companies: every fixture entity gets a fresh key
// and nothing is deleted but the fixture's own jobs.
beforeEach(async () => { const jobs = await prisma.job.findMany({ where: { sources: { some: { sourceKey: SOURCE } } } });
  await prisma.jobSource.deleteMany({ where: { jobId: { in: jobs.map(job => job.id) } } });
  await prisma.job.deleteMany({ where: { id: { in: jobs.map(job => job.id) } } }); });
afterAll(async () => { const jobs = await prisma.job.findMany({ where: { sources: { some: { sourceKey: SOURCE } } } });
  await prisma.jobSource.deleteMany({ where: { jobId: { in: jobs.map(job => job.id) } } });
  await prisma.job.deleteMany({ where: { id: { in: jobs.map(job => job.id) } } }); await prisma.$executeRaw`TRUNCATE "SourceIngestionAdmission", "SourceIdentityReview"`;
  await prisma.source.deleteMany({ where: { key: { in: portalKeys } } });
  await prisma.$disconnect(); });

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

async function portalFixture(scope: 'SINGLE_BRAND' | 'MULTI_BRAND' | null = 'SINGLE_BRAND', createOwner = true) {
  const k = randomUUID().slice(0, 8), key = `portal-native-${k}`; portalKeys.push(key);
  const name = `Synthetic Portal ${k}`; const ownerKey = resolveCompany(name).companyId;
  const source = await prisma.source.create({ data: { key, maison: name, kind: 'workday', config: {
    tenant: key, site: 'External', origin: `https://${key}.wd5.myworkdayjobs.com` }, tier: 'ATS_OFFICIAL', tenantKey: key, status: 'DRAFT' } });
  const owner = createOwner ? await prisma.company.create({ data: { name, canonicalKey: ownerKey, fashionjobsUrl: `resolved:${ownerKey}` } }) : null;
  if (scope) await recordSourceIdentityReview(prisma, { ...await captureIdentityFixture(prisma, source), portalScope: scope }, true);
  const candidate = (rawName?: string) => toCandidate({ externalId: `native-${k}`, title: 'Client Advisor', url: `https://${key}.wd5.myworkdayjobs.com/External/job/1`,
    company: rawName, raw: { hiringOrganization: rawName ? { name: rawName } : undefined } },
    { key, company: name, tier: 'ATS_OFFICIAL' }, rawName ?? name, 'WORKDAY');
  return { key, name, source, owner, ownerKey, candidate };
}

it('preserves an explicit native employer despite a real SINGLE_BRAND portal review, until a scoped alias proves the relationship', async () => {
  const f = await portalFixture(); const native = `Legal Entity ${randomUUID().slice(0, 8)} Nederland BV`;
  expect(await certifiedPortalIdentity(prisma, f.key)).toMatchObject({ scope: 'SINGLE_BRAND', ownerName: f.name, ownerKey: f.ownerKey });
  const candidate = f.candidate(native), before = JSON.stringify(candidate.raw);
  const resolved = await prisma.$transaction(tx => resolveEmployer(tx, candidate));
  expect(resolved).toMatchObject({ rule: 'NATIVE_SOURCE_LABEL', company: null, newName: native, newKey: expect.stringMatching(/^SOURCE_/), rawEmployerName: native });
  expect(resolved.rule).not.toBe('CERTIFIED_SINGLE_BRAND_PORTAL');
  expect(JSON.stringify(candidate.raw)).toBe(before);
  await prisma.$transaction(async tx => {
    const review = await tx.employerIdentityReview.create({ data: { id: randomUUID(), statement: 'Synthetic source-scoped alias evidence for this exact legal entity', evidence: [], planHash: 'fixture', reviewedBy: 'integration', reviewedAt: new Date() } });
    await tx.companyAlias.create({ data: { aliasKey: employerAliasKey(f.key, native), displayName: native, normalizedName: normalizedEmployerName(native),
      companyId: f.owner!.id, sourceKey: f.key, sourceHash: sourceIdentityHash(f.source), reviewId: review.id } });
    expect(await resolveEmployer(tx, candidate)).toMatchObject({ company: { id: f.owner!.id }, rule: 'REVIEWED_ALIAS', rawEmployerName: native, reviewId: review.id });
    throw new Error('ROLLBACK_ALIAS_WITNESS');
  }).catch(error => { expect(error.message).toBe('ROLLBACK_ALIAS_WITNESS'); });
});
it('uses the reviewed owner only for a missing employer, and records the source review used', async () => {
  const f = await portalFixture(), candidate = f.candidate();
  expect(candidate.employerLabelOrigin).toBe('SOURCE_CATALOGUE_LABEL');
  const identity = (await certifiedPortalIdentity(prisma, f.key))!;
  const raw = { detail: { jobPostingInfo: { jobDescription: 'Native duties with no declared employer' } } };
  const missing = { externalId: 'missing-detail-employer', title: 'Client Advisor', url: `https://${f.key}.wd5.myworkdayjobs.com/External/job/2`,
    publicationHold: 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL', raw };
  const completed = employerFromCertifiedScope(missing, f.name, 'SINGLE_BRAND');
  const inferred = toCandidate(completed, { key: f.key, company: f.name, tier: 'ATS_OFFICIAL' }, f.name, 'WORKDAY');
  expect(inferred.employerLabelOrigin).toBe('portal.certifiedScope:EMPLOYER_INFERRED_FROM_CERTIFIED_SINGLE_BRAND_PORTAL');
  expect(await prisma.$transaction(tx => resolveEmployer(tx, inferred))).toMatchObject({ company: { id: f.owner!.id }, reviewId: identity.reviewId });
  expect(completed.raw).toBe(raw); expect(raw).not.toHaveProperty('company');

  const resolved = await prisma.$transaction(tx => resolveEmployer(tx, candidate));
  expect(resolved).toMatchObject({ company: { id: f.owner!.id }, rule: 'CERTIFIED_SINGLE_BRAND_PORTAL', reviewId: identity.reviewId });
  await recordEmployerObservation(prisma, candidate, f.owner!.id, resolved);
  expect(await prisma.employerObservation.findFirstOrThrow({ where: { sourceKey: f.key } })).toMatchObject({
    labelOrigin: 'SOURCE_CATALOGUE_LABEL', rule: 'CERTIFIED_SINGLE_BRAND_PORTAL', reviewId: identity.reviewId });
});
it('creates a missing owner under the reviewed identity instead of a source-derived name', async () => {
  const f = await portalFixture('SINGLE_BRAND', false);
  expect(await prisma.$transaction(tx => resolveEmployer(tx, f.candidate()))).toMatchObject({ company: null, newKey: f.ownerKey, newName: f.name, rule: 'CERTIFIED_SINGLE_BRAND_PORTAL' });
});
it.each(['MULTI_BRAND', null] as const)('does not turn a registry label into an employer under %s', async scope => {
  const f = await portalFixture(scope);
  await expect(prisma.$transaction(tx => resolveEmployer(tx, f.candidate()))).rejects.toBeInstanceOf(EmployerIdentityReviewRequired);
});
it('holds a missing employer after a registry revision change', async () => {
  const f = await portalFixture(); await prisma.source.update({ where: { key: f.key }, data: { jobUrlPattern: 'changed' } });
  await expect(prisma.$transaction(tx => resolveEmployer(tx, f.candidate()))).rejects.toBeInstanceOf(EmployerIdentityReviewRequired);
});
it('never replaces the known employer of an existing posting with an inferred portal owner', async () => {
  const f = await portalFixture(); const previous = await fixture();
  await prisma.jobSource.create({ data: { sourceKey: f.key, externalId: previous.base.externalId, jobId: previous.job.id,
    url: `https://${f.key}.wd5.myworkdayjobs.com/External/job/1`, sourceTier: 'ATS_OFFICIAL', raw: {} } });
  await expect(prisma.$transaction(tx => resolveEmployer(tx, { ...f.candidate(), externalId: previous.base.externalId }))).rejects.toBeInstanceOf(EmployerIdentityReviewRequired);
});

it('keeps an unknown native legal name verbatim without requiring a portal-owner certificate', async () => {
  const f = await portalFixture(null, false), native = `Distinct Entity ${randomUUID().slice(0, 8)} France S.A.R.L.`;
  const candidate = f.candidate(native);
  expect(candidate.company).not.toBe(native); // The old spelling heuristic removed legal/country words.
  const result = await prisma.$transaction(tx => resolveEmployer(tx, candidate));
  expect(result).toMatchObject({ rule: 'NATIVE_SOURCE_LABEL', company: null, newName: native, newKey: expect.stringMatching(/^SOURCE_/), rawEmployerName: native });
  expect(result.rule).not.toBe('CERTIFIED_SINGLE_BRAND_PORTAL');
});
it('does not use an alias of the registry label as evidence of a missing posting employer', async () => {
  const f = await portalFixture(null);
  await prisma.$transaction(async tx => {
    const review = await tx.employerIdentityReview.create({ data: { id: randomUUID(), statement: 'Synthetic alias of a registry name; no posting employer is attested.', evidence: [], planHash: 'fixture', reviewedBy: 'integration', reviewedAt: new Date() } });
    await tx.companyAlias.create({ data: { aliasKey: employerAliasKey(f.key, f.name), displayName: f.name, normalizedName: normalizedEmployerName(f.name),
      companyId: f.owner!.id, sourceKey: f.key, sourceHash: sourceIdentityHash(f.source), reviewId: review.id } });
    await expect(resolveEmployer(tx, f.candidate())).rejects.toBeInstanceOf(EmployerIdentityReviewRequired);
    throw new Error('ROLLBACK_ALIAS_WITNESS');
  }).catch(error => { expect(error.message).toBe('ROLLBACK_ALIAS_WITNESS'); });
});
