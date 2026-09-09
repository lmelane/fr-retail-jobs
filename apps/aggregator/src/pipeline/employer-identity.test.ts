import '../test/setup-integration.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { upsertDeduplicated } from '../dedup/upsert.js';
import { resolveCompany } from '../normalize/company.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import { buildEmployerRepair, applyEmployerRepair, type EmployerRepairSpec } from '../identity/repair.js';
import { digest } from '../remediation/plan.js';

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
  it('preserves genuine numerals, countries, legal forms and Unicode in comparison labels', () => {
    for (const name of ['Maison 123', 'DEVRED 1902', 'Medik8', 'Coach Shanghai Limited 2', 'LTD INTERNATIONAL', 'France', '資生堂']) {
      expect(normalizedEmployerName(name)).toBe(name.normalize('NFKC').toLowerCase());
    }
  });
  it('rejects a new inferred suffix merge and archives its evidence without creating a job', async () => {
    await company('Coach Shanghai');
    await expect(upsertDeduplicated(p, posting('Coach Shanghai Limited'))).rejects.toThrow('needs evidence');
    expect(await p.job.count()).toBe(0);
    expect(await p.employerObservation.findFirst({ where: { rule: 'REVIEW_REQUIRED' } })).toMatchObject({ rawEmployerName: 'Coach Shanghai Limited', canonicalEmployerId: null });
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
    // different unreviewed spelling is refused, not treated as an alias.
    await expect(upsertDeduplicated(p, posting('Promod France', 'other', 'other-source'))).rejects.toThrow('needs evidence');
    expect(await p.job.count({ where: { companyId: b.id } })).toBe(1);
  });
  it('blocks stale plans and rolls back an invalid evidence change', async () => {
    const { b, plan } = await pair(); await p.company.update({ where: { id: b.id }, data: { domain: 'promod.fr' } });
    await expect(applyEmployerRepair(p, plan, digest(plan), 'abcdef0123456789')).rejects.toThrow('changed since planning');
    expect(await p.employerIdentityReview.count()).toBe(0);
  });
  it('refuses to discard colliding ATS IDs to make a company merge fit', async () => {
    const { a, b } = await pair();
    const source = await p.job.findFirstOrThrow({ where: { companyId: a.id }, omit: { searchText: true } });
    const { id, createdAt, updatedAt, ...copy } = source;
    await p.job.create({ data: { ...copy, companyId: b.id, raw: copy.raw ?? undefined } });
    const plan = await buildEmployerRepair(p, spec(a.id, b.id));
    await expect(applyEmployerRepair(p, plan, digest(plan), 'abcdef0123456789')).rejects.toThrow('Posting identity collision');
    expect(await p.job.count()).toBe(2); expect(await p.employerIdentityReview.count()).toBe(0);
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
