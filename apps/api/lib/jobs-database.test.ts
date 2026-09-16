import { publicationFixture } from '../../aggregator/src/test/publication-fixture';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as database from '@catwalks/db/occupations';
import { prisma } from '@catwalks/db';
import { getJobs, getJobStatus, getOfferState, resolveOfferParam, type JobFilters } from './jobs';
import { offerPath } from './offer-url';

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const prefix = 'audit-facets-';
const group = 'Audit Facets 301';
/** Toutes les recherches de ce témoin vivent sur le marché français, dans le groupe témoin. */
const fr = (extra: Partial<JobFilters> = {}, filtres: JobFilters['filtres'] = {}): JobFilters =>
  ({ marche: 'FR', ...extra, filtres: { groupe: [group], ...filtres } });
const facette = (r: Awaited<ReturnType<typeof getJobs>>, cle: string) => r.facettes.find((f) => f.cle === cle)?.options ?? [];

describe.skipIf(!enabled)('search against a dedicated local database', () => {
  const cleanup = async () => {
    await prisma.jobSource.deleteMany({ where: { job: { id: { startsWith: prefix } } } }); await prisma.job.deleteMany({ where: { id: { startsWith: prefix } } });
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
      fingerprint: `${prefix}${i}`, isActive: true, postedAt: new Date('2026-01-01'), countryCode: 'FR', isFrance: true,
      firstSeenAt: new Date('2026-01-01'),
    })) });
    await prisma.jobSource.createMany({ data: Array.from({ length: 301 }, (_, i) => ({
      jobId: `${prefix}${String(i).padStart(3, '0')}`, sourceKey: 'audit-facets', sourceTier: 'ATS_OFFICIAL',
      externalId: String(i), url: `https://example.com/jobs/${i}`, isActive: true,
      ...publicationFixture({ sourceKey: 'audit-facets', sourceTier: 'ATS_OFFICIAL', externalId: String(i), url: `https://example.com/jobs/${i}`, title: 'Conseiller de vente', postedAt: new Date('2026-01-01'), country: 'FR' }),
    })) });
  });
  afterAll(cleanup);

  it('counts all 301 companies in sector and group totals', async () => {
    const result = await getJobs(fr());
    expect(result.total).toBe(301);
    expect(result.totalConfirmes).toBe(301);
    expect(facette(result, 'secteur')).toEqual([{ value: 'unclassified', label: 'Secteur à vérifier', count: 301 }]);
    // Le groupe est sélectionné : sa facette compte SANS sa propre sélection, donc le groupe reste proposé.
    expect(facette(result, 'groupe').find((o) => o.value === group)).toEqual({ value: group, label: group, count: 301 });
    expect(facette(result, 'maison')).toHaveLength(301);
    expect(result.perimetre).toMatchObject({ code: 'FR', pays: ['FR'], mesure: true });
  });

  it('accepts a new sector and localized label as reviewed data without changing frontend enums',async()=>{
    const {previewSectors,applySectors}=await import('../../aggregator/src/sectors/review');
    const concept={code:'AUDIT_NEW_VERTICAL',slug:'audit-new-vertical',labels:{fr:'Verticale témoin',en:'Witness vertical'},definition:'Dedicated test concept',position:100};
    const c=await prisma.company.findUniqueOrThrow({where:{id:`${prefix}0`}});
    // Reviews are immutable: give each test execution a distinct review identity.
    const m={reviewer:`web integration ${randomUUID()}`,concepts:[concept],companies:[{id:c.id,canonicalKey:c.canonicalKey,codes:[concept.code,'WATCHMAKING'],evidence:[concept.code,'WATCHMAKING'].map(code=>({code,source:'https://example.com/sector-proof',statement:'Independent business sector evidence fixture',confidence:'HIGH' as const,basis:'OFFICIAL_SOURCE' as const,checkedAt:'2026-09-09T00:00:00Z'}))}]};
    const plan=await previewSectors(prisma,m);await applySectors(prisma,m,plan.reviewHash);
    const r=await getJobs(fr({}, {secteur: [concept.code]}));expect(r.total).toBe(1);
    // La facette secteur exclut sa propre sélection : le concept témoin y figure avec son libellé.
    expect(facette(r,'secteur').find(s=>s.value===concept.code)).toEqual({value:concept.code,label:concept.labels.fr,count:1});
    expect((await getJobs(fr({}, {secteur: ['WATCHMAKING']}))).total).toBe(1);
    expect((await getJobs(fr())).total).toBe(301);
    expect((await getJobs(fr({}, {secteur: ['NO_SUCH_SECTOR']}))).total).toBe(0);
  });

  it('uses a stable order for tied dates across successive pages (curseur, lot 7)', async () => {
    const first = await getJobs(fr());
    expect(first.suivant).not.toBeNull();
    const second = await getJobs(fr({ apres: first.suivant! }));
    const ids = [...first.jobs, ...second.jobs].map(job => job.id);
    expect(new Set(ids).size).toBe(50);
    expect(ids).toEqual(Array.from({ length: 50 }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`));
  });

  it.each([
    { q: 'Conseiller vente', attendu: 301 }, { q: 'Audit', attendu: 301 }, { q: 'absent', attendu: 0 },
    { q: 'Conseiller', secteur: ['LUXURY'], attendu: 0 }, { pays: ['FR'], attendu: 301 },
    { maison: [`${prefix}12`], attendu: 1 },
  ])('preserves filter semantics: %j', async ({ attendu, q, ...filtres }) => {
    const r = await getJobs(fr({ q }, filtres));
    expect(r.total).toBe(attendu);
    // `pays=FR` sur le marché français (lien hérité de l'époque mondiale) ne change rien : ni filtre, ni refus.
    expect(r.filtresRefuses).toEqual([]);
  });

  it('updates the indexed document after posting edits and company renames', async () => {
    const id = `${prefix}000`;
    await prisma.job.update({ where: { id }, data: { title: 'UniqueSearchTitle' } });
    expect((await getJobs(fr({ q: 'UniqueSearchTitle' }))).total).toBe(1);
    await prisma.company.update({ where: { id: `${prefix}0` }, data: { name: 'UniqueMaisonLabel' } });
    expect((await getJobs(fr({ q: 'UniqueMaisonLabel' }))).total).toBe(1);
    await prisma.job.update({ where: { id }, data: { title: 'Conseiller de vente' } });
    await prisma.company.update({ where: { id: `${prefix}0` }, data: { name: `${prefix}0` } });
    expect((await getJobs(fr({ q: 'UniqueSearchTitle' }))).total).toBe(0);
    expect((await getJobs(fr({ q: 'UniqueMaisonLabel' }))).total).toBe(0);
  });
  it('keeps literal results while adding a reviewed occupation synonym and stable filter',async()=>{
    const id=`${prefix}000`,catalogue=await database.loadOccupationTaxonomy(prisma);
    await prisma.job.update({where:{id},data:{title:'Sales Advisor',...catalogue.classify('Sales Advisor')}});
    await prisma.jobSource.update({ where: { sourceKey_externalId: { sourceKey: 'audit-facets', externalId: '0' } }, data: publicationFixture({ sourceKey: 'audit-facets', externalId: '0', url: 'https://example.com/jobs/0', title: 'Sales Advisor' }) });
    const result=await getJobs(fr({q:'Conseiller de vente'}));
    expect(result.total).toBe(301); // 300 literal FR titles + one reviewed EN occupation.
    const precise=await getJobs(fr({}, {metier: ['sales-advisor']}));
    expect(precise.total).toBe(1);expect(precise.jobs[0].title).toBe('Sales Advisor');
    expect(precise.jobs[0].occupationLabel).toBe(catalogue.occupations.get('sales-advisor')!.labels.fr);
    expect(facette(precise,'metier').find(o=>o.value==='sales-advisor')).toEqual({value:'sales-advisor',label:catalogue.occupations.get('sales-advisor')!.labels.fr,count:1});
    expect((await getJobs(fr({}, {metier: ['unclassified']}))).total).toBe(300);
    expect((await getJobs(fr({q:'Conseiller de vente Lyon'}))).total).toBe(0);
    await prisma.job.update({where:{id},data:{title:'Conseiller de vente',occupationCode:null,occupationStatus:'PENDING',occupationReleaseId:null}});
  });
  it('returns the same offers when optional occupation presentation is unavailable',async()=>{
    const spy=vi.spyOn(database,'loadOccupationTaxonomy').mockRejectedValueOnce(new Error('Witness: occupation catalogue unavailable'));
    try{
      const result=await getJobs(fr());expect(result.total).toBe(301);expect(result.occupationEnrichmentAvailable).toBe(false);
      expect(result.jobs.every(j=>j.title.length>0)).toBe(true);
    }finally{spy.mockRestore();}
  });
  it('resolves an absorbed posting for pages, old URLs and the middleware status probe', async () => {
    const target = `${prefix}000`, origin = `${prefix}old-posting`;
    // Les fermetures récentes de la Maison, hors offres absorbées (l'oracle Intelligence a disparu au lot 12).
    const fermeesRecentes = () => prisma.job.count({ where: { companyId: `${prefix}0`, mergedIntoId: null, isActive: false, closedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } });
    await prisma.job.create({ data: {
      id: origin, companyId: `${prefix}0`, externalId: 'old-posting', source: 'GENERIC_JSONLD',
      title: 'Ancien titre', url: 'https://example.com/old-posting', fingerprint: origin,
      isActive: false, mergedIntoId: target, closedAt: new Date(),
      events: { create: { type: 'MERGED', field: 'mergedInto', after: target } },
    } });
    const state = await getJobStatus(origin);
    expect(state.status).toBe('active');
    if (state.status !== 'active') throw new Error('Canonical posting missing');
    expect(state.job.id).toBe(target);
    expect(await getOfferState(origin)).toBe('active');
    expect((await resolveOfferParam(origin))).toMatchObject({ status: 'active', job: { id: target }, matchedId: origin });
    expect(offerPath(state.job)).not.toContain(origin);
    expect(await fermeesRecentes()).toBe(0);
    await prisma.job.update({ where: { id: target }, data: { isActive: false, closedAt: new Date() } });
    expect(await getOfferState(origin)).toBe('closed');
    expect((await getJobStatus(origin)).status).toBe('closed');
    expect(await fermeesRecentes()).toBe(1);
    await prisma.job.delete({ where: { id: origin } });
    await prisma.job.update({ where: { id: target }, data: { isActive: true, closedAt: null } });
  });
});
