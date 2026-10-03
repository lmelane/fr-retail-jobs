import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, expect, it } from 'vitest';
import { applyRepairPlan, digest } from '../remediation/plan.js';
import { planReplacedIdentity } from '../remediation/replacedIdentity.js';

/**
 * D-522 §6, Kastner & Öhler (03/10/2026) : le nouveau lecteur (`wordpress-post-type`) relit les mêmes offres sous une autre
 * identité. Le plan retire, après la première collecte sous la nouvelle configuration, les représentations de l'ancienne
 * révision (remplacées ou non listées), sans fermeture ni toucher aux nouvelles.
 */
const db = new PrismaClient(); const keys: string[] = []; const companies: string[] = [];
afterAll(async () => {
  await db.jobSource.deleteMany({ where: { sourceKey: { in: keys } } });
  await db.job.deleteMany({ where: { companyId: { in: companies } } });
  await db.$disconnect();
});
const A = 'https://www.kastner-oehler.at/job-karriere/angebot/';

async function kastner() {
  const key = `kastner-${randomUUID()}`; keys.push(key);
  const company = await db.company.create({ data: { name: 'Kastner & Öhler', canonicalKey: key, fashionjobsUrl: `resolved:${key}`, domain: 'kastner-oehler.at' } });
  companies.push(company.id);
  await db.source.create({ data: { key, maison: 'Kastner & Öhler', kind: 'generic-listing', config: { startUrl: `${A}backoffice/` }, tenantKey: `generic:${key}`, status: 'ACTIVE', tier: 'EMPLOYER_DIRECT' } });
  const oldRevision = (await db.source.findUniqueOrThrow({ where: { key } })).currentRevisionId!;
  const offer = async (revisionId: string, url: string, externalId: string) => {
    const batch = await db.captureBatch.create({ data: { sourceKey: key, configHash: 'x', readerRevision: 'test', sourceRevisionId: revisionId } });
    return db.job.create({ data: { companyId: company.id, externalId: `${key}:${externalId}`, source: 'GENERIC_JSONLD', title: 'Modeberater*in', url,
      sources: { create: { sourceKey: key, externalId: `${key}:${externalId}`, sourceTier: 'EMPLOYER_DIRECT', url, captureBatchId: batch.id } } }, omit: { searchText: true } });
  };
  const pages = ['graz/', 'innsbruck/', 'spittal/'].map((p) => `${A}${p}`);
  const oldJobs = await Promise.all([...pages, `${A}retiree/`].map((url, i) => offer(oldRevision, url, `sha1-${i}`)));
  await db.source.update({ where: { key }, data: { config: { startUrl: `${A}../offene-stellen/`, reader: 'wordpress-post-type', postType: 'jobangebot' } } });
  const current = (await db.source.findUniqueOrThrow({ where: { key } })).currentRevisionId!;
  return { key, oldRevision, current, oldJobs, pages, offer };
}
const spec = (key: string, replacedRevisionId: string, expectedReplaced: number, expectedUnlisted: number) => ({ batchId: randomUUID(), sourceKey: key,
  replacedRevisionId, expectedReplaced, expectedUnlisted, statement: 'mêmes offres relues sous l’identité du billet WordPress' });

it('refuse avant la première collecte, puis retire les anciennes identités sans fermeture, et se rejoue sans nouvelle correction', async () => {
  const { key, oldRevision, current, oldJobs, pages, offer } = await kastner();
  await expect(planReplacedIdentity(db, spec(key, oldRevision, 3, 1))).rejects.toThrow('No active representation from the current revision yet');
  const newJobs = await Promise.all(pages.map((url, i) => offer(current, url, `post-${i}`)));
  const plan = await planReplacedIdentity(db, spec(key, oldRevision, 3, 1));
  expect(plan.operations.filter((op) => op.entity === 'Job').map((op) => op.id).sort()).toEqual(oldJobs.map((job) => job.id).sort());
  expect(await applyRepairPlan(db, plan, digest(plan), 'test')).toMatchObject({ written: 8, lifecycleViolations: 0 });
  for (const job of oldJobs) {
    expect(await db.job.findUniqueOrThrow({ where: { id: job.id }, omit: { searchText: true } })).toMatchObject({ isActive: false, closedAt: null, withdrawalReason: 'PUBLICATION_UNVERIFIED' });
    expect(await db.jobEvent.count({ where: { jobId: job.id, type: 'CLOSED' } })).toBe(0);
  }
  for (const job of newJobs) expect(await db.job.findUniqueOrThrow({ where: { id: job.id }, omit: { searchText: true } })).toMatchObject({ isActive: true, withdrawnAt: null });
  expect(await applyRepairPlan(db, plan, digest(plan), 'test')).toMatchObject({ alreadyApplied: true, written: 0 });
});
