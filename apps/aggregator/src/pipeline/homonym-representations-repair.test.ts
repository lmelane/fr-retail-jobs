import '../test/setup-integration.js';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, expect, it } from 'vitest';
import { applyRepairPlan, digest } from '../remediation/plan.js';
import { planHomonymRepresentations } from '../remediation/homonymRepresentations.js';

/**
 * D-522 §6, Sioux (03/10/2026) : la révision v1 de la source (Recruitee « sioux ») lisait le portail de Sioux Technologies,
 * un homonyme ; 19 offres restent actives sous la Maison. La source est gardée et corrigée : seules les représentations
 * collectées par la révision homonyme sont retirées, sans toucher la Société de la vraie Maison.
 */
const db = new PrismaClient(); const keys: string[] = []; const companies: string[] = [];
// Les offres partent avec leurs représentations : une offre active laissée sans source casserait l'invariant de cycle de vie
// (global) des plans suivants.
afterAll(async () => {
  await db.jobSource.deleteMany({ where: { sourceKey: { in: keys } } });
  await db.job.deleteMany({ where: { companyId: { in: companies } } });
  await db.$disconnect();
});

async function sioux(homonymOffers = 3, laterOffers = 1) {
  const key = `sioux-${randomUUID()}`; keys.push(key);
  const company = await db.company.create({ data: { name: 'Sioux', canonicalKey: key, fashionjobsUrl: `resolved:${key}`, domain: 'sioux.de' } });
  companies.push(company.id);
  await db.source.create({ data: { key, maison: 'Sioux', kind: 'recruitee', config: { subdomain: 'sioux' }, tenantKey: `recruitee:${key}`, status: 'ACTIVE', tier: 'ATS_OFFICIAL' } });
  const homonymRevision = (await db.source.findUniqueOrThrow({ where: { key } })).currentRevisionId!;
  const offer = async (revisionId: string, index: number) => {
    const batch = await db.captureBatch.create({ data: { sourceKey: key, configHash: 'x', readerRevision: 'test', sourceRevisionId: revisionId } });
    const url = `https://jobs.sioux.asia/o/role-${revisionId.slice(0, 4)}-${index}`;
    return db.job.create({ data: { companyId: company.id, externalId: url, source: 'RECRUITEE', title: `Engineer ${index}`, url,
      sources: { create: { sourceKey: key, externalId: url, sourceTier: 'ATS_OFFICIAL', url, captureBatchId: batch.id } } }, omit: { searchText: true } });
  };
  const homonymJobs = await Promise.all(Array.from({ length: homonymOffers }, (_, i) => offer(homonymRevision, i)));
  // La source corrigée : une nouvelle révision (déclencheur), la page carrières de la Maison.
  await db.source.update({ where: { key }, data: { kind: 'generic-listing', config: { startUrl: 'https://www.sioux.de/pages/stellenangebote' }, status: 'PAUSED' } });
  const current = (await db.source.findUniqueOrThrow({ where: { key } })).currentRevisionId!;
  const laterJobs = await Promise.all(Array.from({ length: laterOffers }, (_, i) => offer(current, 100 + i)));
  return { key, company, homonymRevision, current, homonymJobs, laterJobs };
}
const spec = (key: string, homonymRevisionId: string, expectedRepresentations: number) => ({ batchId: randomUUID(), sourceKey: key, homonymRevisionId,
  expectedRepresentations, homonym: { name: 'Sioux Technologies', proofUrl: 'https://jobs.sioux.asia/', statement: 'portail Recruitee de Sioux Technologies, homonyme' } });

it('retire seulement les offres de la révision homonyme, garde la source et la Société, et se rejoue sans nouvelle correction', async () => {
  const { key, company, homonymRevision, current, homonymJobs, laterJobs } = await sioux();
  // Prémisse : la révision homonyme n'est plus la configuration courante, et des offres actives viennent des deux révisions.
  expect(current).not.toBe(homonymRevision);
  expect(await db.jobSource.count({ where: { sourceKey: key, isActive: true } })).toBe(4);
  const plan = await planHomonymRepresentations(db, spec(key, homonymRevision, 3));
  expect(plan.operations.filter(op => op.entity === 'Job').map(op => op.id).sort()).toEqual(homonymJobs.map(job => job.id).sort());
  expect(plan.operations.some(op => op.entity === 'Company' || op.entity === 'Source')).toBe(false);
  expect(await applyRepairPlan(db, plan, digest(plan), 'test')).toMatchObject({ written: 6, lifecycleViolations: 0 });
  for (const job of homonymJobs) {
    expect(await db.job.findUniqueOrThrow({ where: { id: job.id }, omit: { searchText: true } })).toMatchObject({ isActive: false, closedAt: null, withdrawalReason: 'IDENTITY_CONTRADICTED' });
    expect(await db.jobEvent.count({ where: { jobId: job.id, type: 'WITHDRAWN' } })).toBe(1);
    expect(await db.jobEvent.count({ where: { jobId: job.id, type: 'CLOSED' } })).toBe(0);
  }
  expect(await db.job.findUniqueOrThrow({ where: { id: laterJobs[0].id }, omit: { searchText: true } })).toMatchObject({ isActive: true, withdrawnAt: null });
  expect(await db.source.findUniqueOrThrow({ where: { key } })).toMatchObject({ status: 'PAUSED', maison: 'Sioux' });
  expect(await db.company.findUniqueOrThrow({ where: { id: company.id } })).toMatchObject({ name: 'Sioux', domain: 'sioux.de' });
  expect(await applyRepairPlan(db, plan, digest(plan), 'test')).toMatchObject({ alreadyApplied: true, written: 0 });
  await expect(planHomonymRepresentations(db, spec(key, homonymRevision, 3))).rejects.toThrow('Reviewed count changed: 0');
});

it('refuse un compte relu différent, la révision courante, et une offre portée aussi par une autre source', async () => {
  const { key, homonymRevision, current, homonymJobs } = await sioux(2, 0);
  await expect(planHomonymRepresentations(db, spec(key, homonymRevision, 3))).rejects.toThrow('Reviewed count changed: 2');
  await expect(planHomonymRepresentations(db, spec(key, current, 1))).rejects.toThrow('still the current configuration');
  const other = `other-${randomUUID()}`; keys.push(other);
  await db.jobSource.create({ data: { jobId: homonymJobs[0].id, sourceKey: other, externalId: 'x', sourceTier: 'ATS_OFFICIAL', url: 'https://example.com/x' } });
  await expect(planHomonymRepresentations(db, spec(key, homonymRevision, 2))).rejects.toThrow('Other active evidence');
});
