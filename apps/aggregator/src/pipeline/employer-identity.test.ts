import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { resolveCompany } from '../normalize/company.js';
import { normalizedEmployerName, employerAliasKey, sameEmployerTypography } from '../normalize/employerName.js';
import { buildEmployerRepair, applyEmployerRepair, type EmployerRepairSpec } from '../identity/repair.js';
import { digest, verifyRepair } from '../remediation/plan.js';
import { recordDiscoveredEmployer } from './discoverFashionJobs.js';

const p = new PrismaClient();
async function clear() {
  await p.source.deleteMany({ where: { key: 'promod' } });
  await p.companyAlias.deleteMany(); await p.jobEvent.deleteMany(); await p.jobSource.deleteMany(); await p.job.deleteMany();
  await p.company.updateMany({ data: { mergedIntoId: null, parentGroupId: null } });
  await p.company.deleteMany(); await p.$executeRaw`TRUNCATE "EmployerObservation", "EmployerIdentityReview" CASCADE`; await p.$executeRaw`TRUNCATE "DataCorrection"`;
}
beforeEach(clear); afterAll(async () => { await clear(); await p.$disconnect(); });
const posting = (rawEmployerName: string, externalId = 'real-input-1', sourceKey = 'promod') => ({
  company: resolveCompany(rawEmployerName).displayName, companyId: resolveCompany(rawEmployerName).companyId, rawEmployerName,
  sourceKey, sourceTier: 'EMPLOYER_DIRECT' as const, externalId, title: 'Vendeur.se', country: 'FR', location: 'Pontivy',
  url: `https://promodjob.talentview.io/jobs/${externalId}`, atsType: 'TALENTVIEW' as const,
  raw: { entity: { id: 598, name: 'Promod - magasin' } },
});
const evidenceText = '<a href="https://promodjob.talentview.io/?source=site_entreprise">Recrutement</a>';
function spec(fromId: string, toId: string): EmployerRepairSpec {
  return { batchId: 'lot1-test-review', statement: 'Promod store recruitment is the same retailer; preserve the upstream label.', reviewedBy: 'integration-test', reviewedAt: '2026-09-09T06:15:00Z',
    evidence: [{ url: 'https://www.promod.fr/fr-fr/', sha256: createHash('sha256').update(evidenceText).digest('hex'), artifactText: evidenceText, explanation: 'Official career link; the real TalentView entity is 598, Promod - magasin.' }],
    merges: [{ fromId, toId }], aliases: [{ sourceKey: 'promod', rawName: 'PROMOD - MAGASIN', companyId: toId }, { sourceKey: 'promod', rawName: 'Promod', companyId: toId }],
  };
}
async function company(name: string) { return p.company.create({ data: { name, canonicalKey: resolveCompany(name).companyId, fashionjobsUrl: `resolved:${resolveCompany(name).companyId}` } }); }
async function pair() {
  const a = await company('PROMOD - MAGASIN'), b = await company('Promod');
  // Legacy input used solely to prepare pre-migration data.
  const { rawEmployerName, ...legacy } = posting(a.name);
  const j = await upsertDeduplicated(p, legacy);
  return { a, b, j, plan: await buildEmployerRepair(p, spec(a.id, b.id)) };
}

describe('Employer identity evidence and conservation', () => {
  it('a repeated directory observation cannot overwrite canonical identity or forget raw drift', async () => {
    const company = { name: 'Maison 123', fashionjobsUrl: 'https://fr.fashionjobs.com/recrutement/maison-123,1.html', fashionjobsSlug: 'maison-123,1', offerCount: 40 };
    const first = await recordDiscoveredEmployer(p, company);
    const before = await p.company.findUniqueOrThrow({ where: { id: first.id } });
    const changed = { ...company, name: 'Maison 123 40', offerCount: 39 };
    expect(await recordDiscoveredEmployer(p, changed)).toEqual({ id: first.id, needsReview: true });
    await recordDiscoveredEmployer(p, changed);
    expect(await p.company.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ name: before.name, canonicalKey: before.canonicalKey, fashionjobsOfferCount: 39 });
    expect(await p.company.count()).toBe(1);
    expect(await p.employerObservation.count()).toBe(2);
    expect(await p.employerObservation.findFirst({ where: { rule: 'REVIEW_REQUIRED' } })).toMatchObject({ rawEmployerName: changed.name, canonicalEmployerId: first.id });
  });
  it('preserves genuine numerals, countries, legal forms and Unicode in comparison labels', () => {
    for (const name of ['Maison 123', 'DEVRED 1902', 'Medik8', 'Coach Shanghai Limited 2', 'LTD INTERNATIONAL', 'France', '資生堂']) {
      expect(normalizedEmployerName(name)).toBe(name.normalize('NFKC').toLowerCase());
    }
  });
  it('publishes a native legal entity separately from an unproved historical suffix alias', async () => {
    await company('Coach Shanghai');
    const result = await upsertDeduplicated(p, posting('Coach Shanghai Limited'));
    expect(await p.job.count()).toBe(1);
    const written = await p.job.findUniqueOrThrow({ where: { id: result.jobId }, include: { company: true } });
    expect(written.company.name).toBe('Coach Shanghai Limited');
    expect(written.company.canonicalKey).toMatch(/^SOURCE_/);
    expect(await p.company.count()).toBe(2);
    expect(await p.sourceObservation.findFirst({ where: { sourceKey: 'promod', externalId: 'real-input-1' } })).not.toBeNull();
  });
  it('new source-scoped identities remain stable on replay', async () => {
    const first = await upsertDeduplicated(p, posting('Maison 123'));
    const second = await upsertDeduplicated(p, posting('Maison 123'));
    expect(second.jobId).toBe(first.jobId);
    expect(await p.company.count()).toBe(1);
    const c = await p.company.findFirstOrThrow(); expect(c.name).toBe('Maison 123'); expect(c.canonicalKey).toMatch(/^SOURCE_/);
  });
  it('merges with proof, preserves job ID/RAW/history, consumes aliases, stays idempotent', async () => {
    const { a, b, j, plan } = await pair();
    const before = await p.jobSource.findMany({ where: { jobId: j.jobId } });
    expect(await applyEmployerRepair(p, plan, digest(plan), 'abcdef0123456789')).toEqual({ alreadyApplied: false, movedJobs: 1, aliases: 2 });
    expect((await p.job.findUniqueOrThrow({ where: { id: j.jobId } })).companyId).toBe(b.id);
    expect(await p.jobSource.findMany({ where: { jobId: j.jobId } })).toEqual(before);
    expect((await p.company.findUniqueOrThrow({ where: { id: a.id } })).mergedIntoId).toBe(b.id);
    const repeat = await upsertDeduplicated(p, posting('PROMOD - MAGASIN'));
    expect(repeat.jobId).toBe(j.jobId); expect(await p.job.count()).toBe(1);
    expect((await p.company.findUniqueOrThrow({ where: { id: b.id } })).name).toBe('Promod');
    expect(await p.employerObservation.findFirst({ where: { rule: 'REVIEWED_ALIAS' } })).toMatchObject({ canonicalEmployerId: b.id, rawEmployerName: 'PROMOD - MAGASIN', reviewId: plan.batchId });
    expect((await applyEmployerRepair(p, plan, digest(plan), 'abcdef0123456789')).alreadyApplied).toBe(true);
  });
  it('does not apply a scoped alias to another source merely sharing its name', async () => {
    const { b, plan } = await pair(); await applyEmployerRepair(p, plan, digest(plan), 'abcdef0123456789');
    // The old ID is redirected because that catalog identity was proved; a
    // different native spelling stays separate, without inheriting this alias.
    const separate = await upsertDeduplicated(p, posting('Promod France', 'other', 'other-source'));
    expect((await p.job.findUniqueOrThrow({ where: { id: separate.jobId } })).companyId).not.toBe(b.id);
    expect(await p.job.count({ where: { companyId: b.id } })).toBe(1);
  });
  it('blocks stale plans and rolls back an invalid evidence change', async () => {
    const { b, plan } = await pair(); await p.company.update({ where: { id: b.id }, data: { domain: 'promod.fr' } });
    await expect(applyEmployerRepair(p, plan, digest(plan), 'abcdef0123456789')).rejects.toThrow('changed since planning');
    expect(await p.employerIdentityReview.count()).toBe(0);
  });
  it('preserves separate tenant publications during a reviewed company merge', async () => {
    const { a, b } = await pair();
    const source = await p.job.findFirstOrThrow({ where: { companyId: a.id }, omit: { searchText: true } });
    const { id, createdAt, updatedAt, ...copy } = source;
    await p.job.create({ data: { ...copy, companyId: b.id, canonicalSourceKey: 'other-tenant',
      raw: copy.raw ?? undefined, occupationEvidence: copy.occupationEvidence ?? undefined, employmentEvidence:copy.employmentEvidence??undefined,
      sources: { create: { sourceKey: 'other-tenant', externalId: source.externalId, sourceTier: 'EMPLOYER_DIRECT',
        url: 'https://other-tenant.example/1', raw: { tenant: 'other-tenant', id: source.externalId } } },
    } });
    const plan = await buildEmployerRepair(p, spec(a.id, b.id));
    await applyEmployerRepair(p, plan, digest(plan), 'abcdef0123456789');
    expect(await p.job.count({ where: { companyId: b.id, mergedIntoId: null } })).toBe(2);
    expect(await p.jobSource.count()).toBe(2);
    expect(await p.employerIdentityReview.count()).toBe(1);
  });
  it('consolidates proven postings atomically and both sources replay into one preserved ID', async () => {
    const a = await company('Old banner'), b = await company('Current banner');
    const input = (name: string, sourceKey: string) => ({ ...posting(name, 'native-42', sourceKey), raw: { posting: { issuer: 'https://careers.example.com', id: 42 } } });
    const { rawEmployerName: ignoredA, ...legacyA } = input(a.name, 'old-portal');
    const { rawEmployerName: ignoredB, ...legacyB } = input(b.name, 'new-portal');
    const old = await upsertDeduplicated(p, legacyA), current = await upsertDeduplicated(p, legacyB);
    const sources = await p.jobSource.findMany({ orderBy: { id: 'asc' } });
    const events = await p.jobEvent.findMany({ orderBy: { id: 'asc' } });
    const before = await p.job.findUniqueOrThrow({ where: { id: old.jobId } });
    const plan = await buildEmployerRepair(p, { ...spec(a.id, b.id), aliases: [
      { sourceKey: 'old-portal', rawName: a.name, companyId: b.id },
      { sourceKey: 'new-portal', rawName: b.name, companyId: b.id },
    ], postingMerges: [{ fromId: old.jobId, toId: current.jobId, issuer: 'https://careers.example.com', postingId: '42', witnesses: sources.map(s => ({ sourceId: s.id, issuerPath: ['posting', 'issuer'], postingIdPath: ['posting', 'id'] })) }] });
    // Same-looking IDs are not enough when the stored issuer contradicts the plan.
    const poisoned = structuredClone(plan); poisoned.postingMerges![0].issuer = 'https://another-tenant.example.com';
    await expect(applyEmployerRepair(p, poisoned, digest(poisoned), 'abcdef0123456789')).rejects.toThrow('Invalid posting RAW witness');
    expect(await p.employerIdentityReview.count()).toBe(0);
    await applyEmployerRepair(p, plan, digest(plan), 'abcdef0123456789');
    expect(await p.job.count()).toBe(2); expect(await p.job.count({ where: { isActive: true } })).toBe(1);
    expect(await p.publicationIdentityDecision.findFirst({ where: { fromJobId: old.jobId, toJobId: current.jobId } }))
      .toMatchObject({ action: 'MOVED', evidence: { rule: 'REVIEWED_RAW_IDENTITY', reviewId: plan.batchId } });
    const review = await p.employerIdentityReview.findUniqueOrThrow({ where: { id: plan.batchId } });
    const artifacts = review.evidence as { artifactText: string; sha256: string }[];
    for (const source of sources) {
      const artifact = artifacts.find(e => e.artifactText.includes(source.id))!;
      expect(JSON.parse(artifact.artifactText)).toEqual(JSON.parse(JSON.stringify(source)));
      expect(createHash('sha256').update(artifact.artifactText).digest('hex')).toBe(artifact.sha256);
    }
    await expect(p.$transaction(tx => verifyRepair(tx, ['lifecycle']))).resolves.toEqual({ lifecycleViolations: 0 });
    expect(await p.job.findUniqueOrThrow({ where: { id: old.jobId } })).toMatchObject({ mergedIntoId: current.jobId, isActive: false, closedAt: before.closedAt });
    expect(await p.jobSource.findMany({ orderBy: { id: 'asc' } })).toEqual(sources.map(s => ({ ...s, jobId: current.jobId })));
    expect(await p.jobEvent.findMany({ where: { id: { in: events.map(e => e.id) } }, orderBy: { id: 'asc' } })).toEqual(events);
    for (let pass = 0; pass < 2; pass++) for (const candidate of [input(a.name, 'old-portal'), input(b.name, 'new-portal')]) {
      expect((await upsertDeduplicated(p, candidate)).jobId).toBe(current.jobId);
    }
    await expect(upsertDeduplicated(p, { ...input(a.name, 'old-portal'), raw: { posting: { issuer: 'https://careers.example.com', id: 43 } } }))
      .rejects.toThrow('PUBLICATION_GROUP_REVIEW_REQUIRED');
    expect(await p.job.count()).toBe(2); expect(await p.job.count({ where: { isActive: true } })).toBe(1);
    await expect(p.job.update({ where: { id: old.jobId }, data: { isActive: true } })).rejects.toThrow();
    await expect(p.job.update({ where: { id: old.jobId }, data: { mergedIntoId: null } })).rejects.toThrow('compensating');
    await expect(p.jobSource.update({ where: { id: sources[0].id }, data: { jobId: old.jobId } })).rejects.toThrow('cannot own source');
    await expect(p.job.update({ where: { id: current.jobId }, data: { companyId: a.id } })).rejects.toThrow('employer mismatch');
    expect((await applyEmployerRepair(p, plan, digest(plan), 'abcdef0123456789')).alreadyApplied).toBe(true);
  });
});

it('enforces reviewed parent links, prevents cycles and preserves immutable evidence', async () => {
  const proof = spec('unused-a', 'unused-b');
  await p.employerIdentityReview.create({ data: { id: proof.batchId, statement: proof.statement, evidence: proof.evidence, reviewedBy: proof.reviewedBy, reviewedAt: new Date(proof.reviewedAt), planHash: 'parent-test' } });
  const parent = await p.company.create({ data: { name: 'Parent Group', kind: 'GROUP', canonicalKey: 'PARENT_GROUP', fashionjobsUrl: 'resolved:PARENT_GROUP' } });
  const child = await p.company.create({ data: { name: 'Subsidiary Group', kind: 'GROUP', canonicalKey: 'SUB_GROUP', fashionjobsUrl: 'resolved:SUB_GROUP' } });
  await expect(p.company.update({ where: { id: child.id }, data: { parentGroupId: parent.id } })).rejects.toThrow();
  await p.company.update({ where: { id: child.id }, data: { parentGroupId: parent.id, identityReviewId: proof.batchId } });
  expect((await p.company.findUniqueOrThrow({ where: { id: child.id } })).parentGroup).toBe('Parent Group');
  await expect(p.company.update({ where: { id: parent.id }, data: { parentGroupId: child.id, identityReviewId: proof.batchId } })).rejects.toThrow('cycle');
  await p.company.update({ where: { id: parent.id }, data: { name: 'Canonical Group' } });
  expect((await p.company.findUniqueOrThrow({ where: { id: child.id } })).parentGroup).toBe('Canonical Group');
  await expect(p.employerIdentityReview.update({ where: { id: proof.batchId }, data: { statement: 'replace proof' } })).rejects.toThrow('append-only');
});

it('does not silently accept a changed employer label on an already-known posting', async () => {
  await company('Acme');
  const { rawEmployerName, ...legacy } = posting('Acme');
  await upsertDeduplicated(p, legacy);
  await upsertDeduplicated(p, posting('Acme'));
  await expect(upsertDeduplicated(p, posting('Acme France'))).rejects.toThrow('needs evidence');
  expect(await p.job.count()).toBe(1);
});

it('re-attests a typographic legal label on the same native posting without merging or rewriting aliases', async () => {
  const prior = 'Thomas Sabo GmbH & Co.KG', native = 'THOMAS SABO GmbH & Co. KG';
  const first = await upsertDeduplicated(p, posting(prior));
  const stableIdentity = { id: true, name: true, canonicalKey: true, fashionjobsUrl: true, mergedIntoId: true, parentGroupId: true } as const;
  const before = await p.company.findMany({ select: stableIdentity });
  const repeated = await upsertDeduplicated(p, posting(native));
  expect(repeated.jobId).toBe(first.jobId);
  expect(await p.company.findMany({ select: stableIdentity })).toEqual(before);
  expect(await p.companyAlias.count()).toBe(0);
  expect(employerAliasKey('promod', prior)).not.toBe(employerAliasKey('promod', native));
  expect(await p.employerObservation.findFirst({ where: { rawEmployerName: native } })).toMatchObject({ rule: 'NATIVE_SOURCE_LABEL' });
  for (const other of ['Thomas Sabo GmbH & Co. KG France', 'Thomas Sabo GmbH & Co. KG 2', 'Thomas Sabo GmbH', 'Thomas Sabo GmbH & Co KG']) {
    expect(sameEmployerTypography(native, other)).toBe(false);
    await expect(upsertDeduplicated(p, posting(other))).rejects.toThrow('needs evidence');
  }
});

it('keeps the posting employer when the same source already has both unreviewed typographic identities', async () => {
  const prior = 'Thomas Sabo GmbH & Co.KG', native = 'THOMAS SABO GmbH & Co. KG';
  const other = await upsertDeduplicated(p, posting(native, 'other-native-posting'));
  const first = await upsertDeduplicated(p, posting(prior));
  const identitySnapshot = () => p.company.findMany({ omit: { updatedAt: true, lastSeenAt: true }, orderBy: { id: 'asc' } });
  const before = await identitySnapshot();
  const jobsBefore = await p.job.findMany({ select: { id: true, companyId: true }, orderBy: { id: 'asc' } });
  expect(before).toHaveLength(2);
  expect(other.jobId).not.toBe(first.jobId);
  const repeated = await upsertDeduplicated(p, posting(native));
  expect(repeated.jobId).toBe(first.jobId);
  expect(await identitySnapshot()).toEqual(before);
  expect(await p.job.findMany({ select: { id: true, companyId: true }, orderBy: { id: 'asc' } })).toEqual(jobsBefore);
  expect(await p.companyAlias.count()).toBe(0);
});

it('does not use typography to ignore reviewed or parent-linked competing identities', async () => {
  const prior = 'Thomas Sabo GmbH & Co.KG', native = 'THOMAS SABO GmbH & Co. KG';
  const other = await upsertDeduplicated(p, posting(native, 'other-native-posting'));
  const first = await upsertDeduplicated(p, posting(prior));
  const targetId = (await p.job.findUniqueOrThrow({ where: { id: other.jobId } })).companyId;
  const parent = await company('Distinct parent');
  await p.company.update({ where: { id: parent.id }, data: { kind: 'GROUP' } });
  const proof = spec(targetId, targetId);
  await p.employerIdentityReview.create({ data: { id: proof.batchId, statement: proof.statement,
    evidence: proof.evidence, planHash: 'reviewed-distinct-employer', reviewedBy: proof.reviewedBy, reviewedAt: new Date(proof.reviewedAt) } });
  await p.company.update({ where: { id: targetId }, data: { parentGroupId: parent.id, identityReviewId: proof.batchId } });
  await expect(upsertDeduplicated(p, posting(native))).rejects.toThrow('needs evidence');
  await p.company.update({ where: { id: targetId }, data: { parentGroupId: null, parentGroup: null } });
  await expect(upsertDeduplicated(p, posting(native))).rejects.toThrow('needs evidence');
  expect((await p.job.findUniqueOrThrow({ where: { id: first.jobId } })).companyId).not.toBe(targetId);
});

it('replaces only a registry-derived brand with the explicitly related native legal employer, retaining separate companies', async () => {
  const brand = await company('Funky Buddha');
  const { rawEmployerName: _, ...legacy } = posting(brand.name);
  const first = await upsertDeduplicated(p, legacy);
  // Historical registry observation, as found in the production RAW audit.
  await p.employerObservation.create({ data: { sourceKey: 'promod', externalId: legacy.externalId,
    observationHash: 'registry-before-native', rawEmployerName: brand.name, normalizedEmployerName: normalizedEmployerName(brand.name),
    canonicalEmployerId: brand.id, labelOrigin: 'SOURCE_CATALOGUE_LABEL', rule: 'LEGACY_UNREVIEWED', pipelineVersion: 1,
    observedAt: new Date(Date.now() + 1) } });
  const statement = 'Η Funky Buddha, σήμα της εταιρείας Αltex S.A., που δραστηριοποιείται στο χώρο της σύγχρονης ένδυσης';
  const config = { company: 'ALTEXSA', nativeEmployerRules: [{ id: 'native-legal-brand-relation',
    employer: { name: 'ALTEX S.A.', role: 'EMPLOYER' }, brands: ['Funky Buddha'],
    when: [{ path: 'company.name', equals: 'ALTEX S.A.' },
      { path: 'jobAd.sections.companyDescription.text', includes: 'Η Funky Buddha, σήμα της εταιρείας Αltex S.A.' }] }] };
  await p.source.create({ data: { key: 'promod', maison: brand.name, kind: 'smartrecruiters', config,
    tier: 'EMPLOYER_DIRECT', tenantKey: 'smartrecruiters:ALTEXSA', status: 'ACTIVE' } });
  const native = { ...posting('ALTEX S.A.'), raw: { company: { name: 'ALTEX S.A.' },
    jobAd: { sections: { companyDescription: { text: statement } } } } };
  // Fake evidence or a name merely mentioned in a different RAW field cannot override history.
  await expect(upsertDeduplicated(p, { ...native, raw: { company: { name: 'ALTEX S.A.' }, footer: statement },
    employerEvidence: { rawName: 'ALTEX S.A.', path: 'footer', rule: 'FAKE', role: 'EMPLOYER', brands: ['Funky Buddha'] } }))
    .rejects.toThrow('needs evidence');
  const accepted = await upsertDeduplicated(p, native);
  expect(accepted.jobId).toBe(first.jobId);
  const written = await p.job.findUniqueOrThrow({ where: { id: first.jobId }, include: { company: true } });
  expect(written.company.name).toBe('ALTEX S.A.');
  expect(written.company.parentGroupId).toBeNull();
  expect(await p.company.findUniqueOrThrow({ where: { id: brand.id } })).toMatchObject({ name: 'Funky Buddha', mergedIntoId: null });
  expect(await p.companyAlias.count()).toBe(0);
  expect(await p.employerObservation.findFirst({ where: { rule: 'NATIVE_EMPLOYER_BRAND_RELATION' } })).not.toBeNull();
  expect((await upsertDeduplicated(p, native)).jobId).toBe(first.jobId);
  await expect(upsertDeduplicated(p, posting('B&S International'))).rejects.toThrow('needs evidence');
});

it('upgrades a legacy alias only through an explicit scoped evidence decision', async () => {
  const c = await company('Promod');
  const old = await p.companyAlias.create({ data: { aliasKey: 'PROMOD_LEGACY', displayName: 'Promod', companyId: c.id } });
  const input = { ...spec('unused', c.id), merges: [], aliases: [{ sourceKey: 'promod', rawName: 'Promod', companyId: c.id, legacyAliasId: old.id }] };
  const plan = await buildEmployerRepair(p, input);
  await applyEmployerRepair(p, plan, digest(plan), 'abcdef0123456789');
  const alias = await p.companyAlias.findUniqueOrThrow({ where: { id: old.id } });
  expect(alias).toMatchObject({ sourceKey: 'promod', reviewId: plan.batchId, normalizedName: 'promod' });
  expect(await p.companyAlias.count()).toBe(1);
  expect(await p.dataCorrection.findFirst({ where: { entityType: 'CompanyAlias', entityId: old.id } })).not.toBeNull();
});

it('does not transfer a reviewed alias when the source key acquires a different tenant', async () => {
  const { plan } = await pair();
  await applyEmployerRepair(p, plan, digest(plan), 'abcdef0123456789');
  await p.source.create({ data: { key: 'promod', maison: 'Promod', kind: 'talentview', config: { slug: 'different-tenant' }, tier: 'EMPLOYER_DIRECT', tenantKey: 'test:changed-promod', status: 'ACTIVE' } });
  await expect(upsertDeduplicated(p, posting('Promod'))).rejects.toThrow('ALIAS_SOURCE_OR_TENANT_CHANGED');
  const prior = await p.companyAlias.findFirstOrThrow({ where: { sourceKey: 'promod', normalizedName: 'promod' } });
  const renewed = await buildEmployerRepair(p, { ...plan, batchId: 'review-renewed-source', merges: [], companies: [], aliases: [{ sourceKey: 'promod', rawName: prior.displayName, companyId: prior.companyId }] });
  await applyEmployerRepair(p, renewed, digest(renewed), 'abcdef0123456789');
  const alias = await p.companyAlias.findUniqueOrThrow({ where: { id: prior.id } });
  expect(alias.reviewId).toBe(renewed.batchId);
  expect(alias.sourceHash).not.toBe(prior.sourceHash);
  expect(await p.employerIdentityReview.findUnique({ where: { id: plan.batchId } })).not.toBeNull();
  await expect(upsertDeduplicated(p, posting('Promod'))).resolves.toBeDefined();
});

it('rejects a repair if the source configuration changed after its review snapshot', async () => {
  const { plan } = await pair();
  await p.source.create({ data: { key: 'promod', maison: 'Promod', kind: 'talentview', config: { slug: 'changed' }, tier: 'EMPLOYER_DIRECT', tenantKey: 'test:changed-promod', status: 'ACTIVE' } });
  await expect(applyEmployerRepair(p, plan, digest(plan), 'abcdef0123456789')).rejects.toThrow('Source identity changed since planning');
  expect(await p.employerIdentityReview.count()).toBe(0);
});

describe('superseding a reviewed alias', () => {
  it('re-points a reviewed alias only through an explicit new decision, archives the previous binding, and refuses a silent conflict', async () => {
    const parent = await p.company.create({ data: { name: 'Free People', canonicalKey: 'FREE_PEOPLE', kind: 'BRAND', fashionjobsUrl: 'resolved:FREE_PEOPLE' } });
    const sub = await p.company.create({ data: { name: 'FP Movement', canonicalKey: 'FP_MOVEMENT', kind: 'BRAND', fashionjobsUrl: 'resolved:FP_MOVEMENT' } });
    await p.source.create({ data: { key: 'promod', maison: 'URBN', kind: 'icims', config: { origin: 'https://hub.example.com' }, tenantKey: 'icims:hub.example.com', tier: 'GROUP_OFFICIAL', status: 'ACTIVE' } });
    const base = { ...spec(parent.id, parent.id), merges: [] as { fromId: string; toId: string }[] };
    const v1 = { ...base, batchId: 'v1', aliases: [{ sourceKey: 'promod', rawName: 'FP Movement', companyId: parent.id }] };
    const plan1 = await buildEmployerRepair(p, v1); await applyEmployerRepair(p, plan1, digest(plan1), 'abcdef0123456789');
    const alias = await p.companyAlias.findFirstOrThrow({ where: { sourceKey: 'promod', displayName: 'FP Movement' } });
    expect(alias.companyId).toBe(parent.id);
    // Same label, another employer, no explicit supersession: refused.
    const silent = await buildEmployerRepair(p, { ...base, batchId: 'v2-silent', aliases: [{ sourceKey: 'promod', rawName: 'FP Movement', companyId: sub.id }], companies: [{ id: parent.id }] });
    await expect(applyEmployerRepair(p, silent, digest(silent), 'abcdef0123456789')).rejects.toThrow('Conflicting alias');
    const plan2 = await buildEmployerRepair(p, { ...base, batchId: 'v2', aliases: [{ sourceKey: 'promod', rawName: 'FP Movement', companyId: sub.id, supersedesAliasId: alias.id }], companies: [{ id: parent.id }] });
    const result = await applyEmployerRepair(p, plan2, digest(plan2), 'abcdef0123456789');
    expect(result.aliases).toBe(1);
    const after = await p.companyAlias.findUniqueOrThrow({ where: { id: alias.id } });
    expect(after.companyId).toBe(sub.id); expect(after.reviewId).toBe('v2');
    const correction = await p.dataCorrection.findFirst({ where: { batchId: 'v2', entityType: 'CompanyAlias', entityId: alias.id } });
    expect((correction?.before as any).companyId).toBe(parent.id);
    expect(await applyEmployerRepair(p, plan2, digest(plan2), 'abcdef0123456789')).toMatchObject({ alreadyApplied: true });
  });
});

it('keeps the production legal label Gianni Versace S.r.l. without inventing an equivalence', async () => {
  const historical = await company('Gianni Versace');
  const input = posting('Gianni Versace S.r.l.', 'Seamstress-Tailor_R_784015', 'versace');
  const first = await upsertDeduplicated(p, input);
  const repeated = await upsertDeduplicated(p, input);
  const job = await p.job.findUniqueOrThrow({ where: { id: first.jobId }, include: { company: true } });
  expect(job.companyId).not.toBe(historical.id);
  expect(job.company.name).toBe('Gianni Versace S.r.l.');
  expect(repeated.jobId).toBe(first.jobId);
});
