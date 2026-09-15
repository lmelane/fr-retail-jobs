import '../test/setup-integration.js';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { applySourceExpiries, planSourceExpiries } from './sourceExpiry.js';

const db = new PrismaClient();
const key = 'expiry-backfill-witness', revision = 'a'.repeat(40);
let auditBefore = 0;
const wipe = async () => {
  await db.job.deleteMany(); await db.company.deleteMany();
  await db.source.deleteMany({ where: { key } });
};
beforeEach(async () => {
  await wipe();
  auditBefore = await db.dataCorrection.count({ where: { finding: 'SOURCE_DECLARED_EXPIRY' } });
  await db.source.create({ data: { key, tenantKey: key, maison: key, kind: 'workday', config: {}, tier: 'ATS_OFFICIAL' } });
  await db.company.create({ data: { id: key, name: key, canonicalKey: key, fashionjobsUrl: `resolved:${key}` } });
});
afterAll(async () => { await wipe(); await db.$disconnect(); });
async function source(id: string, raw: object) {
  return db.job.create({ data: { id, companyId: key, externalId: id, source: 'WORKDAY', title: id,
    url: `https://example.com/${id}`, fingerprint: id,
    sources: { create: { id: `js-${id}`, sourceKey: key, sourceTier: 'ATS_OFFICIAL', externalId: id, url: `https://example.com/${id}`, raw } },
  } });
}
const payload = { detail: { jobPostingInfo: { endDate: '2026-09-30' } } };
describe('deadline backfill from original source payloads', () => {
  it('bounds pages and source scope, writes evidence once, and safely resumes', async () => {
    await source('a', payload); await source('b', payload); await source('c', { unrelated: { validThrough: '2020-01-01' } });
    const first = await planSourceExpiries(db, [key], undefined, 1);
    const second = await planSourceExpiries(db, [key], first.nextCursor, 1);
    expect(first.plan.entries.map(entry => entry.id)).toEqual(['js-a']);
    expect(second.plan.entries.map(entry => entry.id)).toEqual(['js-b']);
    expect((await planSourceExpiries(db, [])).scanned).toBe(0);
    const before = await db.jobSource.findUniqueOrThrow({ where: { id: 'js-b' } });
    expect(await applySourceExpiries(db, first.plan, first.plan.planHash, revision)).toEqual({ written: 1, alreadyApplied: false });
    expect(await applySourceExpiries(db, first.plan, first.plan.planHash, revision)).toEqual({ written: 0, alreadyApplied: true });
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: 'js-b' } })).toEqual(before);
    expect(await db.jobSource.findUniqueOrThrow({ where: { id: 'js-a' } })).toMatchObject({
      expiresAt: new Date('2026-10-01T12:00:00Z'), expiryEvidence: { path: '$.detail.jobPostingInfo.endDate', value: '2026-09-30' },
    });
    expect(await db.dataCorrection.count({ where: { finding: 'SOURCE_DECLARED_EXPIRY' } })).toBe(auditBefore + 1);
    expect(await db.sourceObservation.findUniqueOrThrow({ where: { sourceKey_externalId_contentHash: {
      sourceKey: key, externalId: 'a', contentHash: first.plan.entries[0].rawHash,
    } } })).toMatchObject({ raw: payload });
    expect((await planSourceExpiries(db, [key])).plan.entries.map(entry => entry.id)).toEqual(['js-b']);
  });

  it.each(['raw', 'lastSeenAt', 'company', 'kind'] as const)('refuses a changed %s before writing any row', async field => {
    await source('a', payload); await source('b', payload);
    const { plan } = await planSourceExpiries(db, [key]);
    if (field === 'raw') await db.jobSource.update({ where: { id: 'js-b' }, data: { raw: { detailReadError: 'timeout' } } });
    if (field === 'lastSeenAt') await db.jobSource.update({ where: { id: 'js-b' }, data: { lastSeenAt: new Date(0) } });
    if (field === 'kind') await db.source.update({ where: { key }, data: { kind: 'generic-listing' } });
    if (field === 'company') {
      await db.company.create({ data: { id: `${key}-other`, name: 'Other', canonicalKey: `${key}-other`, fashionjobsUrl: `resolved:${key}-other` } });
      await db.job.update({ where: { id: 'b' }, data: { companyId: `${key}-other` } });
    }
    await expect(applySourceExpiries(db, plan, plan.planHash, revision)).rejects.toThrow('Stale or unsupported expiry evidence');
    expect(await db.jobSource.count({ where: { expiresAt: { not: null } } })).toBe(0);
    expect(await db.dataCorrection.count({ where: { finding: 'SOURCE_DECLARED_EXPIRY' } })).toBe(auditBefore);
  });

  it('refuses a modified payload or mismatched plan hash', async () => {
    await source('a', payload);
    const { plan } = await planSourceExpiries(db, [key]);
    await expect(applySourceExpiries(db, plan, '0'.repeat(64), revision)).rejects.toThrow('Invalid expiry plan');
    plan.entries[0].expiresAt = '2030-01-01T00:00:00Z';
    await expect(applySourceExpiries(db, plan, plan.planHash, revision)).rejects.toThrow('Invalid expiry plan');
    expect(await db.jobSource.count({ where: { expiresAt: { not: null } } })).toBe(0);
  });
});
