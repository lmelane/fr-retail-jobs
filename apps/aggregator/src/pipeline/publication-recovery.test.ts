import '../test/setup-integration.js';
import { beforeEach, afterAll, describe, it, expect } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { planPublicationGroups, applyPublicationGroups } from '../dedup/repair.js';
import { publicationContentOf } from '@catwalks/db/publication-presentation';
import { evidenceHash } from '../lib/evidenceHash.js';

const db = new PrismaClient();
const at = new Date('2024-02-20T12:00:00Z');
beforeEach(async () => { await db.jobSource.deleteMany(); await db.job.deleteMany(); await db.company.deleteMany(); });
afterAll(async () => { await db.jobSource.deleteMany(); await db.job.deleteMany(); await db.company.deleteMany(); await db.$disconnect(); });
async function fixture() {
  const key = randomUUID();
  await db.source.create({ data: { key, maison: 'Recovery', kind: 'lever', config: { site: 'recovery' }, tier: 'EMPLOYER_DIRECT', tenantKey: key, status: 'ACTIVE' } });
  const company = await db.company.create({ data: { name: 'Recovery', canonicalKey: key, fashionjobsUrl: key } });
  const job = await db.job.create({ data: { companyId: company.id, externalId: 'one', source: 'LEVER', title: 'Wrong shared title', description: 'Shared text cannot be evidence', url: 'https://jobs.lever.co/recovery/one', canonicalSourceKey: key, canonicalExternalId: 'one' } });
  const members = [];
  for (const id of ['one', 'two']) members.push(await db.jobSource.create({ data: { jobId: job.id, sourceKey: key, externalId: id, sourceTier: 'EMPLOYER_DIRECT',
    url: `https://jobs.lever.co/recovery/${id}`, title: 'Old parsed title', firstSeenAt: at, lastSeenAt: at,
    raw: { id, text: `Native ${id}`, hostedUrl: `https://jobs.lever.co/recovery/${id}`, descriptionPlain: `Native description ${id}`, country: id === 'one' ? 'FR' : 'US' } } }));
  const request = { jobIds: [job.id], groups: members.map((s, i) => ({ ...(i === 0 ? { jobId: job.id } : {}), sourceIds: [s.id] })), reason: 'Recover each distinct retained native publication without reattestation' };
  return { job, members, request };
}
describe('historical publication recovery plan', () => {
  it('separates from retained RAW, preserves observation times, and records honest immutable provenance', async () => {
    const { members, request } = await fixture();
    const beforeCaptures = await db.captureBatch.count();
    const plan = await planPublicationGroups(db, request);
    expect(plan.groups.flatMap(g => g.presentations).every(p => p.proof.origin === 'RETAINED_RAW')).toBe(true);
    expect(await applyPublicationGroups(db, plan, plan.planHash)).toMatchObject({ alreadyApplied: false, groups: 2 });
    for (const previous of members) {
      const row = await db.jobSource.findUniqueOrThrow({ where: { id: previous.id }, include: { job: true } });
      expect(row).toMatchObject({ firstSeenAt: at, lastSeenAt: at, captureBatchId: null, captureOutputId: null, raw: previous.raw });
      expect(row.job).toMatchObject({ title: `Native ${row.externalId}`, description: `Native description ${row.externalId}` });
      expect(publicationContentOf(row)?.title).toBe(row.job!.title);
    }
    expect(await db.captureBatch.count()).toBe(beforeCaptures);
    const receipt = await db.dataCorrection.findFirstOrThrow({ where: { entityId: plan.planHash } });
    expect(receipt.evidence).toMatchObject({ outputs: expect.arrayContaining([expect.objectContaining({ origin: 'RETAINED_RAW', sourceLastSeenAt: at.toISOString(), rawHash: evidenceHash(members[0].raw) })]) });
    await expect(db.dataCorrection.update({ where: { id: receipt.id }, data: { evidence: {} } })).rejects.toThrow('append-only');
    expect(await applyPublicationGroups(db, plan, plan.planHash)).toMatchObject({ alreadyApplied: true });
  });
  it('refuses missing native text even when the old group has a description', async () => {
    const { members, request } = await fixture();
    const raw = { ...(members[0].raw as Prisma.InputJsonObject) }; delete raw.descriptionPlain;
    await db.jobSource.update({ where: { id: members[0].id }, data: { raw } });
    await expect(planPublicationGroups(db, request)).rejects.toThrow('CONTENT_MISSING');
  });
  it('rejects a newer RAW or a forged reconstruction after preview', async () => {
    const { members, request } = await fixture();
    const plan = await planPublicationGroups(db, request);
    const { planHash: _hash, ...body } = structuredClone(plan);
    (body.groups[0].patch as Record<string, unknown>).description = 'Forged';
    const forged = { ...body, planHash: evidenceHash(body) };
    await expect(applyPublicationGroups(db, forged, forged.planHash)).rejects.toThrow('changed');
    await db.jobSource.update({ where: { id: members[0].id }, data: { raw: { ...(members[0].raw as Record<string, unknown>), descriptionPlain: 'New observation' } } });
    await expect(applyPublicationGroups(db, plan, plan.planHash)).rejects.toThrow('changed');
    expect(await db.dataCorrection.count({ where: { entityId: { in: [plan.planHash, forged.planHash] } } })).toBe(0);
  });
});
