import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it,vi } from 'vitest';
import * as database from '@catwalks/db/occupations';
import { prisma } from '@catwalks/db';
import { getJobs, whereClause, getJobStatus, getOfferState, resolveOfferParam } from './jobs';
import { offerPath } from './offer-url';
import { closedFacts } from './intelligence/facts';

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const prefix = 'audit-facets-';
const group = 'Audit Facets 301';

describe.skipIf(!enabled)('search against a dedicated local database', () => {
  const cleanup = async () => {
    await prisma.job.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: prefix } } });
  };
  beforeAll(async () => {
    await cleanup();
    await prisma.company.createMany({ data: Array.from({ length: 301 }, (_, i) => ({
      id: `${prefix}${i}`, name: `${prefix}${i}`, canonicalKey: `${prefix}${i}`,
      fashionjobsUrl: `resolved:${prefix}${i}`, sector: 'LUXURY' as const, parentGroup: group,
    })) });
    await prisma.job.createMany({ data: Array.from({ length: 301 }, (_, i) => ({
      id: `${prefix}${String(i).padStart(3, '0')}`, companyId: `${prefix}${i}`, externalId: String(i),
      source: 'GENERIC_JSONLD' as const, title: 'Conseiller de vente', url: `https://example.com/jobs/${i}`,
      fingerprint: `${prefix}${i}`, isActive: true, postedAt: new Date('2026-01-01'),
      firstSeenAt: new Date('2026-01-01'),
    })) });
  });
  afterAll(cleanup);

  it('counts all 301 companies in sector and group totals', async () => {
    const result = await getJobs({ group });
    expect(result.total).toBe(301);
    expect(result.facets.sectors.filter(s=>s.count>0)).toEqual([{value:'unclassified',label:'Secteur à vérifier',count:301}]);
    expect(result.facets.sectors.some(s=>s.value==='WATCHMAKING'&&s.label==='Horlogerie')).toBe(true);
    expect(result.facets.groups).toEqual([{ value: group, count: 301 }]);
    expect(result.facets.maisons).toHaveLength(301);
  });

  it('accepts a new sector and localized label as reviewed data without changing frontend enums',async()=>{
    const {previewSectors,applySectors}=await import('../../aggregator/src/sectors/review');
    const concept={code:'AUDIT_NEW_VERTICAL',slug:'audit-new-vertical',labels:{fr:'Verticale témoin',en:'Witness vertical'},definition:'Dedicated test concept',position:100};
    const c=await prisma.company.findUniqueOrThrow({where:{id:`${prefix}0`}});
    // Reviews are immutable: give each test execution a distinct review identity.
    const m={reviewer:`web integration ${randomUUID()}`,concepts:[concept],companies:[{id:c.id,canonicalKey:c.canonicalKey,codes:[concept.code,'WATCHMAKING'],evidence:[concept.code,'WATCHMAKING'].map(code=>({code,source:'https://example.com/sector-proof',statement:'Independent business sector evidence fixture',confidence:'HIGH' as const,basis:'OFFICIAL_SOURCE' as const,checkedAt:'2026-09-09T00:00:00Z'}))}]};
    const plan=await previewSectors(prisma,m);await applySectors(prisma,m,plan.reviewHash);
    const r=await getJobs({sector:concept.code,group});expect(r.total).toBe(1);expect(r.facets.sectors.find(s=>s.value===concept.code)).toEqual({value:concept.code,label:concept.labels.fr,count:1});
    expect((await getJobs({sector:'WATCHMAKING',group})).total).toBe(1);
    expect((await getJobs({group})).total).toBe(301);
    expect((await getJobs({sector:'NO_SUCH_SECTOR',group})).total).toBe(0);
  });

  it('uses a stable order for tied dates across successive pages', async () => {
    const first = await getJobs({ group, page: 1 });
    const second = await getJobs({ group, page: 2 });
    const ids = [...first.jobs, ...second.jobs].map(job => job.id);
    expect(new Set(ids).size).toBe(50);
    expect(ids).toEqual(Array.from({ length: 50 }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`));
  });

  it.each([
    { q: 'Conseiller vente' }, { q: 'Audit' }, { q: 'absent' },
    { q: 'Conseiller', sector: 'LUXURY' }, { country: 'FR' },
    { maison: `${prefix}12` }, { source: 'absent-source' },
  ])('preserves filter semantics against the original query: %j', async filters => {
    const scoped = { ...filters, group };
    expect((await getJobs(scoped)).total).toBe(await prisma.job.count({ where: whereClause(scoped) }));
  });

  it('updates the indexed document after posting edits and company renames', async () => {
    const id = `${prefix}000`;
    await prisma.job.update({ where: { id }, data: { title: 'UniqueSearchTitle' } });
    expect((await getJobs({ q: 'UniqueSearchTitle', group })).total).toBe(1);
    await prisma.company.update({ where: { id: `${prefix}0` }, data: { name: 'UniqueMaisonLabel' } });
    expect((await getJobs({ q: 'UniqueMaisonLabel', group })).total).toBe(1);
    await prisma.job.update({ where: { id }, data: { title: 'Conseiller de vente' } });
    await prisma.company.update({ where: { id: `${prefix}0` }, data: { name: `${prefix}0` } });
    expect((await getJobs({ q: 'UniqueSearchTitle', group })).total).toBe(0);
    expect((await getJobs({ q: 'UniqueMaisonLabel', group })).total).toBe(0);
  });
  it('keeps literal results while adding a reviewed occupation synonym and stable filter',async()=>{
    const id=`${prefix}000`,catalogue=await database.loadOccupationTaxonomy(prisma);
    await prisma.job.update({where:{id},data:{title:'Sales Advisor',...catalogue.classify('Sales Advisor')}});
    const result=await getJobs({q:'Conseiller de vente',group});
    expect(result.total).toBe(301); // 300 literal FR titles + one reviewed EN occupation.
    const precise=await getJobs({occupation:'sales-advisor',group});
    expect(precise.total).toBe(1);expect(precise.jobs[0].title).toBe('Sales Advisor');
    expect(precise.jobs[0].occupationLabel).toBe(catalogue.occupations.get('sales-advisor')!.labels.fr);
    expect(precise.facets.occupations).toEqual([{value:'sales-advisor',label:catalogue.occupations.get('sales-advisor')!.labels.fr,count:1}]);
    expect((await getJobs({occupation:'unclassified',group})).total).toBe(300);
    expect((await getJobs({q:'Conseiller de vente Lyon',group})).total).toBe(0);
    await prisma.job.update({where:{id},data:{title:'Conseiller de vente',occupationCode:null,occupationStatus:'PENDING',occupationReleaseId:null}});
  });
  it('returns the same offers when optional occupation presentation is unavailable',async()=>{
    const spy=vi.spyOn(database,'loadOccupationTaxonomy').mockRejectedValueOnce(new Error('Witness: occupation catalogue unavailable'));
    try{
      const result=await getJobs({group});expect(result.total).toBe(301);expect(result.occupationEnrichmentAvailable).toBe(false);
      expect(result.jobs.every(j=>j.title.length>0)).toBe(true);
    }finally{spy.mockRestore();}
  });
  it('resolves an absorbed posting for pages, old URLs and the middleware status probe', async () => {
    const target = `${prefix}000`, origin = `${prefix}old-posting`;
    await prisma.job.create({ data: {
      id: origin, companyId: `${prefix}0`, externalId: 'old-posting', source: 'GENERIC_JSONLD',
      title: 'Ancien titre', url: 'https://example.com/old-posting', fingerprint: origin,
      isActive: false, mergedIntoId: target, closedAt: new Date(),
      events: { create: { type: 'MERGED', field: 'mergedInto', after: target } },
    } });
    const state = await getJobStatus(origin);
    expect(state.status).toBe('active');
    if (state.status === 'missing') throw new Error('Canonical posting missing');
    expect(state.job.id).toBe(target);
    expect(await getOfferState(origin)).toBe('active');
    expect((await resolveOfferParam(origin))).toMatchObject({ status: 'active', job: { id: target }, matchedId: origin });
    expect(offerPath(state.job)).not.toContain(origin);
    expect((await closedFacts({ companyId: `${prefix}0` })).closed30d).toBe(0);
    await prisma.job.update({ where: { id: target }, data: { isActive: false, closedAt: new Date() } });
    expect(await getOfferState(origin)).toBe('closed');
    expect((await getJobStatus(origin)).status).toBe('closed');
    expect((await closedFacts({ companyId: `${prefix}0` })).closed30d).toBe(1);
    await prisma.job.delete({ where: { id: origin } });
    await prisma.job.update({ where: { id: target }, data: { isActive: true, closedAt: null } });
  });
});
