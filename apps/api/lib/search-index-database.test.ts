import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, Prisma } from '@catwalks/db';
import { initializeSearchIndex, drainSearchIndex, retireSearchGeneration, SEARCH_VERSION } from './search-index';
import { getJobs } from './jobs';
import { publicationFixture } from '../../aggregator/src/test/publication-fixture';
import { suggestTitles } from './suggestions';
import { exigerPerimetre } from './perimetre';
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const enabled = !!url && ['localhost','127.0.0.1'].includes(url.hostname) && /test/i.test(url.pathname);
const prefix = 'search-live-';
const sync = async () => { while (await drainSearchIndex()) {} };
const search = (q: string, marche = 'FR') => getJobs({ q, marche, filtres: { maison: ['Search Native Maison'] } });
describe.skipIf(!enabled)('durable search projection and live public API', () => {
  const cleanup = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: prefix } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: prefix } } });
    await sync();
  };
  beforeAll(async () => {
    await initializeSearchIndex(); await cleanup();
    await prisma.company.create({ data: { id: prefix+'company', name: 'Search Native Maison', canonicalKey: prefix+'company', fashionjobsUrl: 'resolved:'+prefix } });
    for (const [id, country, title] of [['fr','FR','Sales Advisor'],['us','US','Sales Advisor'],['deputy','FR','Assistant Store Manager'],['deputy-director','FR','Assistant Store Director'],['senior','FR','Senior Sales Advisor']]) {
      const url = 'https://example.com/'+prefix+id;
      await prisma.job.create({ data: { id: prefix+id, companyId: prefix+'company', title, countryCode: country, source: 'GENERIC_JSONLD', externalId: id, url,
        sources: { create: { sourceKey: prefix, sourceTier: 'ATS_OFFICIAL', externalId: id, url, ...publicationFixture({ sourceKey: prefix, externalId: id, title, country, url }) } },
      } });
    }
    await prisma.directOffer.create({ data: { id: prefix+'direct', version: 1n, appliedSeq: 1n, eligible: true, payloadHash: 'test', payload: {}, correspondanceVersion: 1,
      slug: 'search-direct', title: 'Conseillère de vente', company: 'Search Native Maison', countryCode: 'FR', location: 'Paris', description: 'Conseiller les clients.',
      applyUrl: 'https://catwalks.io/offres/search-direct', postedAt: new Date(), modifiedAt: new Date(),
    } });
    await sync();
  });
  afterAll(cleanup);
  it('retrieves unclassified roles in both languages, composes employer intent, and prioritizes Catwalks', async () => {
    const fr = await search('conseiller de vente Search Native Maison');
    const en = await search('sales advisor Search Native Maison');
    expect(fr.jobs.map(j => j.id)).toEqual(en.jobs.map(j => j.id));
    expect(fr.total).toBe(3);
    expect(fr.jobs[0].origine).toBe('CATWALKS');
    expect(fr.jobs[0].candidature.type).toBe('CATWALKS');
    expect(fr.jobs.every(j => j.countryCode === 'FR')).toBe(true);
    expect((await search('sales advisor Search Native Maison','US')).total).toBe(1);
    expect((await search('senior sales advisor Search Native Maison')).total).toBe(1);
    expect((await search('store manager Search Native Maison')).total).toBe(0);
  });
  it('closes both origins immediately without waiting for indexing and observes expiry by clock', async () => {
    await prisma.job.update({ where: { id: prefix+'fr' }, data: { isActive: false } });
    await prisma.directOffer.update({ where: { id: prefix+'direct' }, data: { validThrough: new Date(Date.now()-1000) } });
    expect((await search('sales advisor')).total).toBe(1);
    await prisma.job.update({ where: { id: prefix+'fr' }, data: { isActive: true } });
    await prisma.directOffer.update({ where: { id: prefix+'direct' }, data: { validThrough: null } });
    expect((await search('sales advisor')).total).toBe(3);
  });
  it('queues country changes for both origins and never leaks stale market membership', async () => {
    const jobId = prefix+'fr', directId = prefix+'direct';
    await prisma.job.update({ where: { id: jobId }, data: { countryCode: 'US' } });
    await prisma.directOffer.update({ where: { id: directId }, data: { countryCode: 'US' } });
    try {
      const before = await search('sales advisor');
      expect(before.jobs.map(j => j.id)).not.toContain(jobId);
      expect(before.jobs.map(j => j.id)).not.toContain('cw_'+directId);
      await sync();
      expect((await search('sales advisor','US')).jobs.map(j => j.id)).toEqual(expect.arrayContaining([jobId,'cw_'+directId]));
    } finally {
      await prisma.job.update({ where: { id: jobId }, data: { countryCode: 'FR' } });
      await prisma.directOffer.update({ where: { id: directId }, data: { countryCode: 'FR' } });
      await sync();
    }
  });
  it('does not lose a native edit made while the indexer acknowledges an older queued document', async () => {
    const id = prefix+'fr';
    await prisma.job.update({ where: { id }, data: { title: 'Watch Technician' } });
    let unlock!: () => void; let locked!: () => void;
    const acquired = new Promise<void>(resolve => { locked=resolve; });
    const release = new Promise<void>(resolve => { unlock=resolve; });
    const indexing = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "SearchPending" WHERE version=${SEARCH_VERSION} AND id=${id} FOR UPDATE`;
      locked(); await release;
      await tx.$executeRaw`DELETE FROM "SearchPending" WHERE version=${SEARCH_VERSION} AND id=${id}`;
    });
    await acquired;
    const edit = prisma.job.update({ where: { id }, data: { title: 'Footwear Developer' } });
    // Start the writer while the acknowledgement lock is held.
    const started = Promise.resolve(edit);
    await new Promise(r => setTimeout(r,30)); unlock();
    await Promise.all([indexing,started]);
    const pending = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "SearchPending" WHERE version=${SEARCH_VERSION} AND id=${id}`;
    expect(pending).toEqual([{ id }]);
    await sync();
    expect((await search('product developer')).jobs.map(j => j.id)).toContain(id);
    expect((await search('watchmaker')).total).toBe(0);
    await prisma.job.update({ where: { id }, data: { title: 'Sales Advisor' } }); await sync();
  });
  it('replays rolled-back index acknowledgements after a native title edit', async () => {
    const id = prefix+'fr';
    await prisma.job.update({ where: { id }, data: { title: 'Senior Sales Advisor' } });
    await expect(prisma.$transaction(async tx => {
      await tx.$executeRaw`DELETE FROM "SearchPending" WHERE version=${SEARCH_VERSION} AND id=${id}`;
      throw Error('interrupted');
    })).rejects.toThrow('interrupted');
    await sync();
    expect((await search('senior sales advisor')).total).toBe(2);
    await prisma.job.update({ where: { id }, data: { title: 'Sales Advisor' } }); await sync();
  });
  it('preserves native direct sectors when an unclassified catalogue employer has the same name',async()=>{
    await prisma.directOffer.update({where:{id:prefix+'direct'},data:{sectorCodes:['FASHION']}});await sync();
    expect((await search('Mode')).jobs.map(j=>j.id)).toEqual(['cw_'+prefix+'direct']);
    await prisma.directOffer.update({where:{id:prefix+'direct'},data:{sectorCodes:[]}});await sync();
  });
  it('invalidates textual group links when a differently punctuated group identity is created',async()=>{
    await prisma.company.update({where:{id:prefix+'company'},data:{parentGroup:'Search-Test Group'}});await sync();
    expect((await search('sales advisor Search Test Group')).total).toBe(3);
    await prisma.company.create({data:{id:prefix+'group',name:'Search Test Group',canonicalKey:prefix+'group',fashionjobsUrl:'resolved:'+prefix+'group'}});await sync();
    expect((await search('sales advisor Search Test Group')).total).toBe(3);
    await prisma.company.delete({where:{id:prefix+'group'}});await sync();
    expect((await search('sales advisor Search Test Group')).total).toBe(3);
    await prisma.company.update({where:{id:prefix+'company'},data:{parentGroup:null}});await sync();
  });
  it('refuses a partial generation instead of presenting an empty catalogue as complete',async()=>{
    await prisma.$executeRaw`UPDATE "SearchGeneration" SET "readyAt"=NULL WHERE version=${SEARCH_VERSION}`;
    try { await expect(search('sales advisor')).rejects.toThrow(); }
    finally { await sync(); }
  });
  it('suggests a cross-language role only in markets with a live matching offer', async () => {
    expect(await suggestTitles('conseiller de ven', exigerPerimetre('US'))).toContain('Conseiller de vente');
    expect(await suggestTitles('conseiller de ven', exigerPerimetre('JP'))).toEqual([]);
  });
  it('retires an old generation without failing a concurrent native enqueue', async () => {
    const version='search-integration-retirement';
    await prisma.$executeRaw`INSERT INTO "SearchGeneration"(version) VALUES (${version})`;
    let unlock!: () => void; let locked!: () => void;
    const acquired = new Promise<void>(resolve => { locked=resolve; });
    const release = new Promise<void>(resolve => { unlock=resolve; });
    const writer=prisma.$transaction(async tx=>{
      // The generation scan and enqueue belong to the same native transaction.
      await tx.$queryRaw`SELECT version FROM "SearchGeneration"`;
      locked(); await release;
      await tx.$executeRaw`SELECT catwalks_search_enqueue(${prefix+'fr'})`;
    });
    await acquired;
    const retiring=retireSearchGeneration(version);
    await new Promise(r=>setTimeout(r,30));unlock();
    await expect(Promise.all([writer,retiring])).resolves.toEqual([undefined,1]);
    const pending=await prisma.$queryRaw<{version:string}[]>`SELECT version FROM "SearchPending" WHERE id=${prefix+'fr'}`;
    expect(pending).toContainEqual({version:SEARCH_VERSION});
    expect(pending).not.toContainEqual({version});await sync();
  });
});
