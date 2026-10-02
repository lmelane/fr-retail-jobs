import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { attachMaisons } from '../identity/maisonPlan.js';
import { resolveCompany } from '../normalize/company.js';

const db = new PrismaClient();
async function clear() {
  await db.jobEvent.deleteMany(); await db.jobSource.deleteMany(); await db.job.deleteMany();
  await db.companyAlias.deleteMany(); await db.company.updateMany({ data: { mergedIntoId: null, parentGroupId: null } }); await db.company.deleteMany();
  await db.$executeRaw`TRUNCATE "EmployerObservation", "EmployerIdentityReview" CASCADE`; await db.$executeRaw`TRUNCATE "DataCorrection"`;
  await db.source.deleteMany({ where: { key: { in: ['puma-r143', 'board-r143'] } } });
}
beforeEach(clear); afterAll(async () => { await clear(); await db.$disconnect(); });

const posting = (rawEmployerName: string, externalId: string, sourceKey = 'puma-r143') => ({
  company: rawEmployerName, companyId: resolveCompany(rawEmployerName).companyId, rawEmployerName,
  sourceKey, sourceTier: 'EMPLOYER_DIRECT' as const, externalId, title: 'Retail Associate', country: 'DE', location: 'Berlin',
  url: `https://puma.wd1.myworkdayjobs.com/Jobs/job/Berlin/${externalId}`, atsType: 'WORKDAY' as const, raw: { externalPath: `/job/Berlin/${externalId}` },
});
const source = (key: string, maison: string) => db.source.create({ data: { key, maison, kind: 'workday', config: {}, tier: 'EMPLOYER_DIRECT', tenantKey: key, status: 'ACTIVE' } });

describe('R-143 §5 — the candidate sees the Maison, the legal entity stays internal', () => {
  it('attaches proven entities to their Maison, creating it from the registry, and keeps them there at the next ingestion', async () => {
    await source('puma-r143', 'Puma');
    await upsertDeduplicated(db, posting('PUMA Europe GmbH', 'R1'));
    await upsertDeduplicated(db, posting('PUMA North America, Inc.', 'R2'));
    expect(await db.company.count({ where: { mergedIntoId: null } })).toBe(2);

    await db.company.updateMany({ where: { name: { startsWith: 'PUMA' } }, data: { domain: 'puma.com', domainSource: 'source-careers' } });
    const first = await attachMaisons(db);
    expect(first).toMatchObject({ maisons: 1, entities: 2, toCreate: ['Puma'], applied: 0 });
    expect(await db.company.count()).toBe(2);
    const reviewed = (first as any).preview;
    expect(reviewed.groups[0]).toMatchObject({ maison: 'Puma', maisonId: null, createDomain: 'puma.com' });

    // Une entité apparue après la relecture : le fichier relu ne correspond plus, rien n'est écrit.
    await upsertDeduplicated(db, posting('PUMA Japan K.K.', 'R9'));
    await expect(attachMaisons(db, { reviewed, commitHash: 'abcdef1' })).rejects.toThrow('REVIEWED_PLAN_MISMATCH');
    expect(await db.company.count({ where: { mergedIntoId: { not: null } } })).toBe(0);
    expect(await db.company.count({ where: { name: 'Puma' } })).toBe(0);
    const again = (await attachMaisons(db) as any).preview;

    const applied = await attachMaisons(db, { reviewed: again, commitHash: 'abcdef1' });
    expect(applied).toMatchObject({ applied: 1, movedJobs: 3, refused: [] });
    const maison = await db.company.findFirstOrThrow({ where: { name: 'Puma', mergedIntoId: null } });
    expect(maison).toMatchObject({ kind: 'MAISON', domain: 'puma.com' });
    expect(await db.job.count({ where: { companyId: maison.id } })).toBe(3);
    expect(await db.company.count({ where: { mergedIntoId: maison.id } })).toBe(3);
    // L'entité reste une ligne interne, retrouvable par son nom ; la prochaine offre qu'elle publie va à la Maison.
    expect(await db.company.findFirst({ where: { name: 'PUMA Europe GmbH' } })).toMatchObject({ mergedIntoId: maison.id });
    const next = await upsertDeduplicated(db, posting('PUMA Europe GmbH', 'R3'));
    expect((await db.job.findUniqueOrThrow({ where: { id: next.jobId } })).companyId).toBe(maison.id);
    // Rejouer ne refait rien.
    const empty = (await attachMaisons(db) as any).preview;
    expect(await attachMaisons(db, { reviewed: empty, commitHash: 'abcdef1' })).toMatchObject({ maisons: 0, applied: 0, refused: [] });
  });

  it('leaves an entity apart when another source names it for another Maison', async () => {
    await source('puma-r143', 'Puma'); await source('board-r143', 'Some Board');
    const own = await upsertDeduplicated(db, posting('PUMA Europe GmbH', 'R1'));
    const entity = (await db.job.findUniqueOrThrow({ where: { id: own.jobId } })).companyId;
    // Un job board a nommé la même entité (par un alias relu, par exemple) : le registre ne parle plus d'une seule voix.
    await db.employerObservation.create({ data: { sourceKey: 'board-r143', externalId: 'B1', observationHash: 'board-r143-B1',
      labelOrigin: 'NATIVE', rawEmployerName: 'PUMA Europe GmbH', normalizedEmployerName: 'puma europe gmbh', canonicalEmployerId: entity,
      rule: 'REVIEWED_ALIAS', pipelineVersion: 1 } });
    const report = await attachMaisons(db);
    expect(report).toMatchObject({ maisons: 0, applied: 0 });
    expect(report.uncertain).toMatchObject([{ name: 'PUMA Europe GmbH', maison: 'Puma', reason: 'SOURCES_DISAGREE' }]);
    expect(await db.company.count({ where: { mergedIntoId: { not: null } } })).toBe(0);
  });

  it('sends the next posting of an entity under a historical key to the Maison through a reviewed alias', async () => {
    await source('puma-r143', 'Puma');
    // Ligne historique : clé du référentiel, pas clé de source. Sans alias, l'offre suivante recréerait l'entité.
    const key = resolveCompany('PUMA Sports India Pvt Ltd.').companyId;
    await db.company.create({ data: { name: 'PUMA Sports India Pvt Ltd.', canonicalKey: key, fashionjobsUrl: `resolved:${key}` } });
    await upsertDeduplicated(db, posting('PUMA Sports India Pvt Ltd.', 'L1'));
    await upsertDeduplicated(db, posting('PUMA Europe GmbH', 'L2'));
    const reviewed = (await attachMaisons(db) as any).preview;
    expect(reviewed.groups[0].entities.find((e: any) => e.name.startsWith('PUMA Sports')).labels).toEqual([{ sourceKey: 'puma-r143', label: 'PUMA Sports India Pvt Ltd.' }]);
    expect(await attachMaisons(db, { reviewed, commitHash: 'abcdef1' })).toMatchObject({ applied: 1, refused: [] });
    const maison = await db.company.findFirstOrThrow({ where: { name: 'Puma', mergedIntoId: null } });
    const next = await upsertDeduplicated(db, posting('PUMA Sports India Pvt Ltd.', 'L3'));
    expect((await db.job.findUniqueOrThrow({ where: { id: next.jobId } })).companyId).toBe(maison.id);
    expect(await db.company.count({ where: { mergedIntoId: null, name: { startsWith: 'PUMA' } } })).toBe(0);
  });
});
