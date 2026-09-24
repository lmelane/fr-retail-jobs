import { initializeSearchIndex, drainSearchIndex } from '../search-index';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { publicJobWhere } from '@catwalks/db/availability';
import { getCompanyAside, getJobStatus, getJobs, getOfferState, getSimilarJobs, resolveOfferParam, type JobFilters } from '../jobs';
import { getCompanies } from '../companies';
import { contratMarches } from '../marches-catalogue';
import { directPubliable } from '../direct-offers';
import { resoudrePerimetre } from '../perimetre';
import { suggestCities, suggestCompanies, suggestTitles } from '../suggestions';

/**
 * LE TÉMOIN DES DEUX ORIGINES (lot 6, D-418/D-419/D-423) — sur une vraie base.
 *
 * Les offres directes Catwalks (`DirectOffer`) et les offres agrégées (`Job`)
 * doivent sortir d'UNE recherche, sous les MÊMES filtres, le MÊME périmètre,
 * les offres Catwalks en tête ; chaque ligne dit son origine et son action de
 * candidature ; une offre directe retirée, échue ou sans pays n'entre dans
 * aucun marché ; la fiche, le statut, les similaires, le bloc Maison, les
 * suggestions, le contrat des marchés et l'annuaire connaissent l'espace `cw_`.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);

const M = 'temoin-origines';
const D = 'temoinOrigines';
const MAISON = 'Maison Origines Témoin';
const SEULE = 'Maison Directe Seule';
const companyId = `${M}-maison`;

type Agregee = { id: string; pays: string; ville: string; contrat: string | null; codePostal?: string; posteLe: string };
const AGREGEES: readonly Agregee[] = [
  { id: 'agg-paris', pays: 'FR', ville: 'Paris', contrat: 'PERMANENT', codePostal: '75008', posteLe: '2026-09-02' },
  { id: 'agg-lyon', pays: 'FR', ville: 'Lyon', contrat: null, posteLe: '2026-09-04' },
  { id: 'agg-austin', pays: 'US', ville: 'Austin', contrat: 'PERMANENT', posteLe: '2026-09-01' },
];
type Directe = {
  id: string; maison: string; pays: string | null; ville: string; titre: string; contrat: string | null; secteurs: string[]; posteLe: string;
  codePostal?: string; eligible?: boolean; finLe?: Date | null;
};
const HIER = new Date(Date.now() - 24 * 3600 * 1000);
const DIRECTES: readonly Directe[] = [
  { id: 'Paris', maison: MAISON, pays: 'FR', ville: 'Paris', titre: 'Visual Merchandiser', contrat: 'PERMANENT', secteurs: ['FASHION'], posteLe: '2026-09-10', codePostal: '75008' },
  { id: 'Lyon', maison: MAISON, pays: 'FR', ville: 'Lyon', titre: 'Conseiller de vente Lyon', contrat: null, secteurs: [], posteLe: '2026-08-01' },
  { id: 'NewYork', maison: MAISON, pays: 'US', ville: 'New York', titre: 'Store Manager Madison', contrat: 'PERMANENT', secteurs: ['FASHION'], posteLe: '2026-09-09' },
  { id: 'Retiree', maison: MAISON, pays: 'FR', ville: 'Paris', titre: 'Offre retirée', contrat: 'PERMANENT', secteurs: [], posteLe: '2026-09-11', eligible: false },
  { id: 'Echue', maison: MAISON, pays: 'FR', ville: 'Paris', titre: 'Offre échue', contrat: 'PERMANENT', secteurs: [], posteLe: '2026-09-11', finLe: HIER },
  { id: 'SansPays', maison: MAISON, pays: null, ville: 'Nulle Part', titre: 'Offre sans pays', contrat: 'PERMANENT', secteurs: [], posteLe: '2026-09-11' },
  { id: 'Seule', maison: SEULE, pays: 'FR', ville: 'Marseille', titre: 'Joaillier', contrat: 'PERMANENT', secteurs: ['JEWELRY'], posteLe: '2026-09-08' },
];
const cw = (id: string) => `cw_${D}${id}`;

const chercher = (marche: string, filtres: JobFilters['filtres'] = {}, extra: Partial<JobFilters> = {}) => getJobs({ marche, ...extra, filtres });
const ids = (r: Awaited<ReturnType<typeof getJobs>>) => r.jobs.map((j) => j.id);
const MAISON_SEULE = { maison: [MAISON] };

describe.skipIf(!enabled)('deux origines, une recherche (lot 6)', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { job: { id: { startsWith: M } } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: M } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: M } } });
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: D } } });
  };
  beforeAll(async () => {
    await nettoyer();
    // `sectorCodes` d'une Maison est protégé par un manifeste revu (lot 4D) : la Maison agrégée reste « non classée »,
    // ce qui rend le secteur FASHION ci-dessous attribuable à la seule origine directe.
    await prisma.company.create({ data: { id: companyId, name: MAISON, canonicalKey: companyId, fashionjobsUrl: `resolved:${companyId}` } });
    for (const g of AGREGEES) {
      const titre = `Conseiller de vente ${g.id}`;
      const lien = `https://example.com/${M}/${g.id}`;
      await prisma.job.create({ data: {
        id: `${M}-${g.id}`, companyId, source: 'GENERIC_JSONLD', externalId: g.id, title: titre, url: lien, city: g.ville, countryCode: g.pays, postalCode: g.codePostal ?? null,
        employmentTerm: g.contrat, language: 'fr', isActive: true, postedAt: new Date(g.posteLe), firstSeenAt: new Date(g.posteLe),
        sources: { create: { sourceKey: M, sourceTier: 'ATS_OFFICIAL', externalId: g.id, url: lien, isActive: true,
          ...publicationFixture({ sourceKey: M, sourceTier: 'ATS_OFFICIAL', externalId: g.id, url: lien, title: titre, city: g.ville,
            country: g.pays, postalCode: g.codePostal, employmentTerm: g.contrat ?? undefined, language: 'fr', postedAt: new Date(g.posteLe) }) } },
      } });
    }
    for (const d of DIRECTES) {
      await prisma.directOffer.create({ data: {
        id: `${D}${d.id}`, version: BigInt(1), appliedSeq: BigInt(1), eligible: d.eligible ?? true, payloadHash: 'temoin', payload: {},
        correspondanceVersion: 1, slug: `slug-${d.id.toLowerCase()}`, title: d.titre, company: d.maison, countryCode: d.pays, city: d.ville,
        postalCode: d.codePostal ?? null, location: `${d.ville}${d.pays ? `, ${d.pays}` : ''}`, employmentTerm: d.contrat, workTime: 'FULL_TIME',
        sectorCodes: d.secteurs, language: 'fr', description: `${d.titre} — description`, applyUrl: `https://catwalks.io/offres/slug-${d.id.toLowerCase()}`,
        postedAt: new Date(d.posteLe), validThrough: d.finLe ?? null, modifiedAt: new Date(d.posteLe),
        searchText: `${d.titre}\n${d.maison}\n${d.ville}\n${d.titre} — description`,
      } });
    }
    await initializeSearchIndex();
    while (await drainSearchIndex()) {}
  }, 120_000);
  afterAll(nettoyer);

  const perimetreFR = () => resoudrePerimetre('FR')!;
  const publiablesFR = async () => (await prisma.job.count({ where: { ...publicJobWhere(), countryCode: 'FR' } }))
    + (await prisma.directOffer.count({ where: { ...directPubliable(), countryCode: 'FR' } }));

  it('PRÉMISSE — les deux tables portent des offres FR de la même Maison, et trois offres directes ne sont pas publiables en FR', async () => {
    expect(await prisma.job.count({ where: { companyId, countryCode: 'FR', isActive: true } })).toBe(2);
    expect(await prisma.directOffer.count({ where: { company: MAISON, countryCode: 'FR' } })).toBe(4);
    expect(await prisma.directOffer.count({ where: { company: MAISON, countryCode: 'FR', ...directPubliable() } })).toBe(2);
  });

  it('une recherche FR sur la Maison rend ses deux origines : les offres Catwalks d’abord, puis les agrégées par fraîcheur', async () => {
    const r = await chercher('FR', MAISON_SEULE);
    expect(ids(r)).toEqual([cw('Paris'), cw('Lyon'), `${M}-agg-lyon`, `${M}-agg-paris`]);
    expect(r.total).toBe(4);
    expect(r.totalConfirmes).toBe(4);
    expect(r.jobs.map((j) => j.origine)).toEqual(['CATWALKS', 'CATWALKS', 'AGREGEE', 'AGREGEE']);
  });

  it('chaque ligne dit son action de candidature : CATWALKS avec l’identifiant, le slug et l’URL ; EXTERNE avec le lien employeur', async () => {
    const r = await chercher('FR', MAISON_SEULE);
    expect(r.jobs[0].candidature).toEqual({ type: 'CATWALKS', offreId: `${D}Paris`, slug: 'slug-paris', url: 'https://catwalks.io/offres/slug-paris' });
    expect(r.jobs[0]).toMatchObject({ title: 'Visual Merchandiser', company: MAISON, countryCode: 'FR', sources: ['catwalks'], sourceCount: 1, occupationStatus: 'UNAVAILABLE' });
    expect(r.jobs[2].candidature).toEqual({ type: 'EXTERNE', url: `https://example.com/${M}/agg-lyon` });
  });

  it('retirée, échue ou sans pays : une offre directe n’entre dans aucun marché — ni FR ni US', async () => {
    const fr = ids(await chercher('FR', MAISON_SEULE));
    const us = ids(await chercher('US', MAISON_SEULE));
    for (const exclue of [cw('Retiree'), cw('Echue'), cw('SansPays')]) {
      expect(fr).not.toContain(exclue);
      expect(us).not.toContain(exclue);
    }
    expect(us).toEqual([cw('NewYork'), `${M}-agg-austin`]);
  });

  it('le filtre exige un contrat connu pour les deux origines', async () => {
    const r = await chercher('FR', { ...MAISON_SEULE, contrat: ['PERMANENT'] });
    expect(ids(r)).toEqual([cw('Paris'), `${M}-agg-paris`]);
    expect(r.jobs.map(j => j.correspondance)).toEqual([{ statut: 'CONFIRMEE' }, { statut: 'CONFIRMEE' }]);
    expect(r.total).toBe(2);
    expect(r.totalConfirmes).toBe(2);
  });

  it('la recherche texte et le lieu touchent les offres directes par leur texte indexé, leur ville et leur code postal', async () => {
    expect(ids(await chercher('FR', MAISON_SEULE, { q: 'Visual Merchandiser' }))).toEqual([cw('Paris')]);
    expect(ids(await chercher('FR', MAISON_SEULE, { lieu: 'Lyon' }))).toEqual([cw('Lyon'), `${M}-agg-lyon`]);
    expect(ids(await chercher('FR', MAISON_SEULE, { lieu: '75008' }))).toEqual([cw('Paris'), `${M}-agg-paris`]);
  });

  it('les facettes comptent les deux origines : le secteur d’une offre directe, la Maison directe seule, le total du périmètre', async () => {
    const r = await chercher('FR', MAISON_SEULE);
    const secteur = r.facettes.find((f) => f.cle === 'secteur')!;
    expect(secteur.options.find((o) => o.value === 'FASHION')).toMatchObject({ count: 1 });
    expect(secteur.options.find((o) => o.value === 'unclassified')).toMatchObject({ count: 3 });
    const maison = r.facettes.find((f) => f.cle === 'maison')!;
    expect(maison.options.find((o) => o.value === MAISON)).toMatchObject({ count: 4 });
    expect(maison.options.find((o) => o.value === SEULE)).toMatchObject({ count: 1 });
    expect(r.totalPerimetre).toBe(await publiablesFR());
  });

  it('la fiche et le statut connaissent l’espace `cw_` : active, fermée (retirée ou échue), absente', async () => {
    const active = await getJobStatus(cw('Paris'));
    expect(active.status).toBe('active');
    expect(active.status === 'active' && active.job.candidature.type).toBe('CATWALKS');
    expect((await getJobStatus(cw('Retiree'))).status).toBe('closed');
    expect((await getJobStatus(cw('Echue'))).status).toBe('closed');
    expect((await getJobStatus('cw_inconnue'))).toEqual({ status: 'missing' });
    expect(await getOfferState(`visual-merchandiser-${cw('Paris')}`)).toBe('active');
    expect(await getOfferState(`offre-retiree-${cw('Retiree')}`)).toBe('closed');
    expect(await getOfferState('offre-cw_inconnue')).toBe('missing');
    const resolu = await resolveOfferParam(`visual-merchandiser-${cw('Paris')}`);
    expect(resolu).toMatchObject({ status: 'active', matchedId: cw('Paris') });
  });

  it('les similaires d’une offre directe : la même Maison dans le même pays, Catwalks d’abord ; le bloc Maison compte les deux origines', async () => {
    const paris = await getJobStatus(cw('Paris'));
    const similaires = await getSimilarJobs(paris.status === 'active' ? paris.job : (() => { throw new Error('active attendue'); })(), 6);
    expect(similaires.map((j) => j.id)).toEqual([cw('Lyon'), `${M}-agg-lyon`, `${M}-agg-paris`]);
    expect(await getCompanyAside(MAISON)).toMatchObject({ openJobs: 7, cities: 5, countries: 2 });
    expect(await getCompanyAside(SEULE)).toEqual({ openJobs: 1, cities: 1, countries: 1, domain: null, sector: null, group: null });
    expect(await getCompanyAside('Maison Inexistante Témoin')).toBeNull();
  });

  it('les suggestions couvrent les deux origines dans le périmètre, et pas hors de lui', async () => {
    expect(await suggestTitles('Visual', perimetreFR())).toContain('Visual Merchandiser');
    expect(await suggestTitles('Visual', resoudrePerimetre('US')!)).not.toContain('Visual Merchandiser');
    expect(await suggestCompanies('Directe Seule', perimetreFR())).toContain(SEULE);
    expect(await suggestCities('Marse', perimetreFR())).toContain('Marseille');
    expect(await suggestCities('Marse', resoudrePerimetre('US')!)).not.toContain('Marseille');
  });

  it('le contrat des marchés compte les offres directes publiables par pays, et les offres sans pays à part', async () => {
    const contrat = await contratMarches();
    expect(contrat.marches.find((m) => m.code === 'FR')!.offresPubliables).toBe(await publiablesFR());
    expect(contrat.catalogue.sansPays).toBeGreaterThanOrEqual(1);
  });

  it('l’annuaire : une Maison connue fusionne ses deux origines sous sa ligne ; une Maison directe seule a sa ligne `cw_`', async () => {
    const r = await getCompanies({ marche: 'FR' });
    const maison = r.companies.find((c) => c.name === MAISON)!;
    expect(maison).toMatchObject({ id: companyId, jobCount: 4 });
    expect(maison.cities).toEqual([{ city: 'Lyon', count: 2 }, { city: 'Paris', count: 2 }]);
    expect(maison.sectors.map((s) => s.code)).toEqual(['FASHION']);
    const seule = r.companies.find((c) => c.name === SEULE)!;
    expect(seule).toMatchObject({ id: 'cw_maison-directe-seule', jobCount: 1, group: null, domain: null, cities: [{ city: 'Marseille', count: 1 }] });
    expect(seule.sectors.map((s) => s.code)).toEqual(['JEWELRY']);
    expect(r.companies.filter((c) => c.name === MAISON)).toHaveLength(1);

    const recherche = await getCompanies({ marche: 'FR', q: 'Directe Seule' });
    expect(recherche.companies.map((c) => c.name)).toEqual([SEULE]);
    expect(recherche.total).toBe(1);
    const joaillerie = await getCompanies({ marche: 'FR', secteur: ['JEWELRY'] });
    expect(joaillerie.companies.map((c) => c.name)).toContain(SEULE);
    expect(joaillerie.companies.map((c) => c.name)).not.toContain(MAISON);
    expect(r.facettes.find((f) => f.cle === 'secteur')!.options.find((o) => o.value === 'JEWELRY')!.count).toBeGreaterThanOrEqual(1);
  });
});
