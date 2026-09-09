import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { runRefresh } from './refresh.js';
import { upsertDeduplicated } from '../dedup/upsert.js';
import { resolveCompany } from '../normalize/company.js';
import { deactivateSources } from './deactivateSources.js';
import type { CandidateJob } from '../dedup/match.js';

/**
 * D38 — l'histoire d'une offre est écrite au moment où elle se joue :
 * OPENED à la création, CLOSED/REOPENED par le refresh (avec `closedAt` et
 * `reopenedCount`), CHANGED par champ structurant à la ré-attestation, et
 * REOPENED quand une source re-liste une offre fermée — ce que
 * `attachToExisting` faisait avant en silence.
 */

const prisma = new PrismaClient();

async function wipe() {
  await prisma.jobEvent.deleteMany({});
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.company.deleteMany({});
  await prisma.sourceRun.deleteMany({});
}

async function company() {
  return prisma.company.create({
    data: { name: 'Acme', canonicalKey: 'acme', fashionjobsUrl: `resolved:acme-${Math.random()}` },
  });
}

async function staleJob(companyId: string, sourceKey: string, externalId: string) {
  const seen = new Date(Date.now() - 72 * 3_600_000);
  return prisma.job.create({
    data: {
      companyId, externalId, source: 'GENERIC_JSONLD', title: 'Vendeur', url: `https://x/${externalId}`,
      fingerprint: `fp-${externalId}`, isActive: true, lastSeenAt: seen,
      sources: {
        create: { sourceKey, sourceTier: 'ATS_OFFICIAL', externalId: `s-${externalId}`, url: `https://x/${externalId}`, isActive: true, lastSeenAt: seen },
      },
    },
  });
}

function candidate(over: Partial<CandidateJob> & { externalId: string; title: string }): CandidateJob & { companyId: string } {
  const company = over.company ?? 'Gucci';
  return {
    sourceKey: 'kering', sourceTier: 'EMPLOYER_DIRECT', atsType: 'GENERIC_JSONLD', raw: {},
    location: 'Paris', country: 'FR', description: 'desc',
    ...over,
    url: over.url ?? `https://x/${over.externalId}`,
    company,
    companyId: resolveCompany(company).companyId,
  } as CandidateJob & { companyId: string };
}

async function eventsOf(jobId: string) {
  return prisma.jobEvent.findMany({ where: { jobId }, orderBy: { at: 'asc' }, select: { type: true, field: true, before: true, after: true } });
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('refresh — closedAt, reopenedCount et événements', () => {
  it('republie une offre retirée sans fabriquer une fermeture ou un repost, à l’ingestion puis au refresh', async () => {
    const input = candidate({ sourceKey: 'withdrawal-witness', externalId: 'w1', title: 'Client Advisor' });
    const created = await upsertDeduplicated(prisma, input);
    const original = await prisma.job.findUniqueOrThrow({ where: { id: created.jobId } });
    await deactivateSources(prisma, { sourceKey: input.sourceKey }, { kind: 'WITHDRAWN', reason: 'SOURCE_RETIRED' });
    const again = await upsertDeduplicated(prisma, input);
    expect(again.jobId).toBe(created.jobId);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: created.jobId } })).toMatchObject({
      isActive: true, closedAt: null, withdrawnAt: null, withdrawalReason: null, reopenedCount: 0, firstSeenAt: original.firstSeenAt,
    });
    await deactivateSources(prisma, { sourceKey: input.sourceKey }, { kind: 'WITHDRAWN', reason: 'SOURCE_RETIRED' });
    await prisma.jobSource.updateMany({ where: { jobId: created.jobId }, data: { isActive: true, lastSeenAt: new Date() } });
    expect(await runRefresh(prisma)).toMatchObject({ reopened: 0, republished: 1, closedJobs: 0 });
    expect((await eventsOf(created.jobId)).map(e => e.type)).toEqual(['OPENED', 'WITHDRAWN', 'REPUBLISHED', 'WITHDRAWN', 'REPUBLISHED']);
    expect(await prisma.job.count()).toBe(1);
  });

  it('préserve une fermeture attestée lorsque la source est ensuite retirée', async () => {
    const input = candidate({ sourceKey: 'already-closed-witness', externalId: 'w2', title: 'Client Advisor' });
    const { jobId } = await upsertDeduplicated(prisma, input);
    const closedAt = new Date();
    await prisma.job.update({ where: { id: jobId }, data: { isActive: false, closedAt } });
    await deactivateSources(prisma, { sourceKey: input.sourceKey }, { kind: 'WITHDRAWN', reason: 'SOURCE_RETIRED' });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ isActive: false, closedAt, withdrawnAt: null });
    expect(await prisma.jobEvent.count({ where: { jobId, type: 'WITHDRAWN' } })).toBe(0);
  });

  it('retire une offre orpheline sans preuve de fermeture et refuse un état actif/retiré contradictoire en base', async () => {
    const c = await company();
    const job = await prisma.job.create({ data: { companyId: c.id, externalId: 'orphan', source: 'GENERIC_JSONLD', title: 'Client Advisor', url: 'https://x/orphan', fingerprint: 'orphan' } });
    expect(await runRefresh(prisma)).toMatchObject({ closedJobs: 0, withdrawn: 1 });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ closedAt: null, withdrawalReason: 'ATTESTATION_MISSING' });
    await expect(prisma.job.update({ where: { id: job.id }, data: { isActive: true } })).rejects.toThrow('Job_withdrawal_state_check');
  });
  it('ferme : closedAt posé + CLOSED ; ré-ouvre : closedAt null, reopenedCount 1 + REOPENED', async () => {
    const c = await company();
    const j = await staleJob(c.id, 'kering', 'k1');
    await prisma.sourceRun.create({ data: { sourceKey: 'kering', status: 'OK', jobs: 100, canAttestAbsence: true, ranAt: new Date() } });

    const before = Date.now();
    const closed = await runRefresh(prisma);
    expect(closed.closedJobs).toBe(1);

    const afterClose = await prisma.job.findUniqueOrThrow({ where: { id: j.id } });
    expect(afterClose.isActive).toBe(false);
    expect(afterClose.closedAt).not.toBeNull();
    expect(afterClose.closedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(afterClose.reopenedCount).toBe(0);
    expect(await eventsOf(j.id)).toEqual([{ type: 'CLOSED', field: null, before: null, after: null }]);

    // La source re-liste l'offre (l'ingest ré-active la JobSource) : le refresh la ré-ouvre.
    await prisma.jobSource.updateMany({ where: { jobId: j.id }, data: { isActive: true, lastSeenAt: new Date() } });
    const reopened = await runRefresh(prisma);
    expect(reopened.reopened).toBe(1);

    const afterReopen = await prisma.job.findUniqueOrThrow({ where: { id: j.id } });
    expect(afterReopen.isActive).toBe(true);
    expect(afterReopen.closedAt).toBeNull();
    expect(afterReopen.reopenedCount).toBe(1);
    expect((await eventsOf(j.id)).map((e) => e.type)).toEqual(['CLOSED', 'REOPENED']);
  });

  it('écrit un CLOSED par offre fermée, en lot', async () => {
    const c = await company();
    await staleJob(c.id, 'kering', 'k1');
    await staleJob(c.id, 'kering', 'k2');
    await staleJob(c.id, 'kering', 'k3');
    await prisma.sourceRun.create({ data: { sourceKey: 'kering', status: 'OK', jobs: 100, canAttestAbsence: true, ranAt: new Date() } });

    const result = await runRefresh(prisma);
    expect(result.closedJobs).toBe(3);
    expect(await prisma.jobEvent.count({ where: { type: 'CLOSED' } })).toBe(3);
    expect(await prisma.job.count({ where: { closedAt: { not: null } } })).toBe(3);
  });
});

describe('upsert — OPENED, CHANGED, REOPENED', () => {
  it('la création écrit OPENED ; une ré-attestation identique n’écrit rien', async () => {
    const created = await upsertDeduplicated(prisma, candidate({ externalId: 'G1', title: 'Vendeur' }));
    expect(created.outcome).toBe('CREATED');
    expect(await eventsOf(created.jobId)).toEqual([{ type: 'OPENED', field: null, before: null, after: null }]);

    const again = await upsertDeduplicated(prisma, candidate({ externalId: 'G1', title: 'Vendeur' }));
    expect(again.outcome).toBe('UPDATED');
    expect((await eventsOf(created.jobId)).map((e) => e.type)).toEqual(['OPENED']);
  });

  it('un titre qui change à la ré-attestation écrit CHANGED(title) avant/après', async () => {
    const created = await upsertDeduplicated(prisma, candidate({ externalId: 'G2', title: 'Vendeur' }));
    await upsertDeduplicated(prisma, candidate({ externalId: 'G2', title: 'Conseiller de vente' }));

    const events = await eventsOf(created.jobId);
    const changed = events.filter((e) => e.type === 'CHANGED');
    expect(changed).toContainEqual({ type: 'CHANGED', field: 'title', before: 'Vendeur', after: 'Conseiller de vente' });
    // La description n'est pas structurante : jamais d'événement pour elle.
    expect(changed.every((e) => e.field !== null && ['title', 'city', 'country', 'companyId', 'jobFunction'].includes(e.field))).toBe(true);
  });

  it('une description plus riche, seule, n’écrit aucun CHANGED', async () => {
    const created = await upsertDeduplicated(prisma, candidate({ externalId: 'G3', title: 'Vendeur', description: 'court' }));
    await upsertDeduplicated(prisma, candidate({ externalId: 'G3', title: 'Vendeur', description: 'une description nettement plus longue' }));
    expect((await eventsOf(created.jobId)).map((e) => e.type)).toEqual(['OPENED']);
  });

  it('un pays normalisé qui change écrit CHANGED(country) — l’auto-guérison laisse une trace', async () => {
    const created = await upsertDeduplicated(prisma, candidate({ externalId: 'G4', title: 'Vendeur', country: 'FR' }));
    await prisma.job.update({ where: { id: created.jobId }, data: { countryCode: 'France' } }); // ligne héritée
    await upsertDeduplicated(prisma, candidate({ externalId: 'G4', title: 'Vendeur', country: 'France' }));
    expect(await eventsOf(created.jobId)).toContainEqual({ type: 'CHANGED', field: 'country', before: 'France', after: 'FR' });
  });

  it('une offre fermée que sa source re-liste : REOPENED + closedAt null + reopenedCount 1', async () => {
    const created = await upsertDeduplicated(prisma, candidate({ externalId: 'G5', title: 'Vendeur' }));
    // Fermée par le refresh (simulé).
    await prisma.job.update({ where: { id: created.jobId }, data: { isActive: false, closedAt: new Date() } });
    await prisma.jobSource.updateMany({ where: { jobId: created.jobId }, data: { isActive: false } });

    const again = await upsertDeduplicated(prisma, candidate({ externalId: 'G5', title: 'Vendeur' }));
    expect(again.jobId).toBe(created.jobId);

    const job = await prisma.job.findUniqueOrThrow({ where: { id: created.jobId } });
    expect(job.isActive).toBe(true);
    expect(job.closedAt).toBeNull();
    expect(job.reopenedCount).toBe(1);
    expect((await eventsOf(created.jobId)).map((e) => e.type)).toEqual(['OPENED', 'REOPENED']);
  });
});
