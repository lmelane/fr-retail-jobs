import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@catwalks/db';
import { oublierVilles } from '../geo';
import { semerVilles, viderVilles, VILLES_TEMOINS } from '../__fixtures__/villes';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { examinerAlerte, type JobFilters } from '../jobs';
import { drainSearchIndex, initializeSearchIndex } from '../search-index';

/**
 * D-515 §2 (lecture D-492 du 02/10/2026) — UNE ALERTE ENVOIE LE CERTAIN D'ABORD, PUIS L'INCOMPLET À PART.
 *
 * L'examen rend les offres qui respectent avec certitude TOUS les critères (`jobs`) et, séparément, celles qui respectent
 * avec certitude tous les autres critères (métier, lieu, Maison…) mais ne précisent pas le contrat ou le temps de travail
 * filtré (`jobsIncompletes`, signalées avec leurs dimensions). Une offre qui DÉCLARE une valeur contraire (un CDD, un
 * stage, un temps partiel) n'apparaît jamais, ni dans l'une ni dans l'autre. Le lieu et le métier restent stricts (R-141).
 *
 * PRÉMISSE : les offres incomplètes sont PLUS FRAÎCHES que les certaines ; mêlées par fraîcheur, elles passeraient devant.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const P = 'd515-alertes-';
const MAISON = `${P}maison`;

type Cas = { id: string; employmentTerm?: string; programType?: string; workTime?: string; heure: number; ville?: string; titre?: string };
const CAS: Cas[] = [
  { id: 'cdi', employmentTerm: 'PERMANENT', workTime: 'FULL_TIME', heure: 1 },
  { id: 'cdi-partiel', employmentTerm: 'PERMANENT', workTime: 'PART_TIME', heure: 2 },
  { id: 'cdd', employmentTerm: 'FIXED_TERM', workTime: 'FULL_TIME', heure: 20 },
  { id: 'stage', programType: 'INTERNSHIP', heure: 21 },
  { id: 'rien', heure: 22 },
  { id: 'temps-partiel-seul', workTime: 'PART_TIME', heure: 23 },
  // Hors des autres critères : une autre ville, un autre métier. Sans contrat, ils ne partent JAMAIS en section 2.
  { id: 'rien-lyon', heure: 24, ville: 'Lyon' },
  { id: 'rien-comptable', heure: 25, titre: 'Comptable fournisseurs' },
];
const FILIGRANE = new Date('2026-09-29T00:00:00Z');
const BORNE_PUBLICATION = new Date('2026-09-01T00:00:00Z');

describe.skipIf(!enabled)('D-515 §2 — l’examen d’une alerte : certaines, puis incomplètes', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: P } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: P } } });
    await initializeSearchIndex();
    while (await drainSearchIndex()) { /* index à jour */ }
  };
  beforeAll(async () => {
    await nettoyer();
    await prisma.company.create({ data: { id: MAISON, name: MAISON, canonicalKey: MAISON, fashionjobsUrl: `resolved:${MAISON}`, sector: 'LUXURY' } });
    for (const c of CAS) {
      const id = `${P}${c.id}`;
      const lien = `https://example.com/${id}`;
      const entree = new Date(Date.UTC(2026, 8, 29, c.heure));
      const titre = c.titre ?? 'Conseiller de vente';
      await prisma.job.create({ data: {
        id, companyId: MAISON, source: 'GENERIC_JSONLD', externalId: id, title: titre, url: lien, countryCode: 'FR',
        city: c.ville ?? 'Paris', isActive: true, postedAt: entree, firstSeenAt: entree,
        employmentTerm: c.employmentTerm ?? null, programType: c.programType ?? null, workTime: c.workTime ?? null,
        sources: { create: { sourceKey: 'd515', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, isActive: true,
          ...publicationFixture({ sourceKey: 'd515', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, title: titre, country: 'FR' }) } },
      } });
    }
    while (await drainSearchIndex()) { /* index à jour */ }
  }, 120_000);
  afterAll(nettoyer);

  /** Les critères d'une alerte enregistrée depuis le site : Maison, métier tapé, lieu, filtres d'emploi. */
  const alerte = (filtres: JobFilters['filtres'], extra: Partial<JobFilters> = {}): JobFilters =>
    ({ marche: 'FR', q: 'Conseiller de vente', lieu: 'Paris', fraicheur: true, comprendre: true, nonPrecisees: true, ...extra,
      filtres: { maison: [MAISON], ...filtres } });
  const court = (ids: { id: string }[]) => ids.map((j) => j.id.slice(P.length));

  it('PRÉMISSE : les incomplètes sont plus fraîches que les certaines, et les hors-critères existent bien sans contrat', () => {
    const c = (id: string) => CAS.find((x) => x.id === id)!;
    expect(c('rien').heure).toBeGreaterThan(c('cdi-partiel').heure);
    expect(c('rien-lyon').employmentTerm).toBeUndefined();
    expect(c('rien-comptable').employmentTerm).toBeUndefined();
  });

  it('« CDI » : les CDI reconnus en section 1 ; les offres sans contrat du même métier et du même lieu en section 2', async () => {
    const e = await examinerAlerte(alerte({ contrat: ['PERMANENT'] }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(e.jobs).sort()).toEqual(['cdi', 'cdi-partiel']);
    expect(e.nouvelles).toBe(2);
    expect(e.total).toBe(2);
    expect(court(e.jobsIncompletes!)).toEqual(['temps-partiel-seul', 'rien']);
    expect(e.incompletes).toBe(2);
    expect(e.jobsIncompletes!.map((j) => j.correspondance)).toEqual([
      { statut: 'NON_CONFIRMEE', dimensions: ['contrat'] }, { statut: 'NON_CONFIRMEE', dimensions: ['contrat'] }]);
  });

  it('une valeur connue et contraire n’apparaît jamais, une autre ville ou un autre métier non plus', async () => {
    const e = await examinerAlerte(alerte({ contrat: ['PERMANENT'] }), FILIGRANE, BORNE_PUBLICATION);
    const tous = [...court(e.jobs), ...court(e.jobsIncompletes!)];
    for (const exclu of ['cdd', 'stage', 'rien-lyon', 'rien-comptable']) expect(tous, exclu).not.toContain(exclu);
  });

  it('« CDI · temps plein » : le temps partiel déclaré est écarté ; l’offre muette sur les deux nomme les deux', async () => {
    const e = await examinerAlerte(alerte({ contrat: ['PERMANENT'], temps: ['FULL_TIME'] }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(e.jobs)).toEqual(['cdi']);
    expect(court(e.jobsIncompletes!)).toEqual(['rien']);
    expect(e.jobsIncompletes![0].correspondance).toEqual({ statut: 'NON_CONFIRMEE', dimensions: ['contrat', 'temps'] });
  });

  it('« CDD » : une offre « CDI » n’est jamais une incomplète d’une alerte « CDD »', async () => {
    const e = await examinerAlerte(alerte({ contrat: ['FIXED_TERM'] }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(e.jobs)).toEqual(['cdd']);
    expect(court(e.jobsIncompletes!)).toEqual(['temps-partiel-seul', 'rien']);
  });

  it('sans filtre d’emploi, il n’y a rien d’incomplet : tout est certain', async () => {
    const e = await examinerAlerte(alerte({}), FILIGRANE, BORNE_PUBLICATION);
    expect(e.incompletes).toBe(0);
    expect(e.jobsIncompletes).toEqual([]);
    expect(court(e.jobs)).toContain('rien');
  });

  // Lecture D-492 du 02/10/2026 (alerte cohérente) : « correspond fortement » (D-515 §2) vaut pour TOUTE dimension inconnue.
  // Sans métier ni lieu posés, la section des incomplètes n'existe pas, contrat et temps de travail compris. Avant ce
  // correctif, l'alerte « CDI » seule envoyait à part les quatre offres muettes, dont celle de Lyon et celle du comptable.
  it('« CDI » seule (Maison, sans métier ni lieu) : les CDI reconnus, aucune incomplète ; « temps plein » seul aussi', async () => {
    const faible = (filtres: JobFilters['filtres']) => alerte(filtres, { q: undefined, lieu: undefined });
    // PRÉMISSE : sans métier ni lieu, les offres muettes de Lyon et du comptable sont DANS la recherche (la Maison seule les
    // retient) ; un examen qui tolérerait l'inconnu les enverrait à part.
    const toutes = await examinerAlerte(faible({}), FILIGRANE, BORNE_PUBLICATION);
    expect(court(toutes.jobs)).toEqual(expect.arrayContaining(['rien', 'rien-lyon', 'rien-comptable', 'temps-partiel-seul']));
    const cdi = await examinerAlerte(faible({ contrat: ['PERMANENT'] }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(cdi.jobs).sort()).toEqual(['cdi', 'cdi-partiel']);
    expect(cdi.nouvelles).toBe(2);
    expect(cdi.incompletes).toBe(0);
    expect(cdi.jobsIncompletes).toEqual([]);
    const temps = await examinerAlerte(faible({ temps: ['FULL_TIME'] }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(temps.jobs).sort()).toEqual(['cdd', 'cdi']);
    expect(temps.incompletes).toBe(0);
    expect(temps.jobsIncompletes).toEqual([]);
    // La même alerte avec un métier tapé, ou un lieu seul, correspond fortement : les muettes du cercle partent à part.
    const metier = await examinerAlerte(alerte({ contrat: ['PERMANENT'] }, { lieu: undefined }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(metier.jobsIncompletes!)).toContain('rien');
    const lieu = await examinerAlerte(alerte({ contrat: ['PERMANENT'] }, { q: undefined }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(lieu.jobsIncompletes!)).toContain('rien');
  });

  it('contrat 1 (sans en-tête) : le filtre strict d’avant, aucune incomplète', async () => {
    const e = await examinerAlerte(alerte({ contrat: ['PERMANENT'] }, { nonPrecisees: undefined }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(e.jobs).sort()).toEqual(['cdi', 'cdi-partiel']);
    // Le document d'avant, au champ près : ni compte ni liste d'incomplètes (témoins différentiels D-496, D-500).
    expect('incompletes' in e).toBe(false);
    expect('jobsIncompletes' in e).toBe(false);
  });

  it('le filigrane vaut pour les deux sections : rien d’ancien ne revient en section 2', async () => {
    const e = await examinerAlerte(alerte({ contrat: ['PERMANENT'] }), new Date(Date.UTC(2026, 8, 29, 22, 30)), BORNE_PUBLICATION);
    expect(court(e.jobs)).toEqual([]);
    expect(court(e.jobsIncompletes!)).toEqual(['temps-partiel-seul']);
  });
});

/**
 * Audit technique du 02/10/2026 (M3, M4) — le CERCLE de la section 2 est celui des certaines, et la route HTTP au contrat 2
 * rend les dimensions de chaque incomplète. Vingt CDI reconnus à Paris remplissent l'anneau de 15 km : une incomplète à
 * Créteil (12 km) est dans le cercle, une incomplète à Fontainebleau (55 km) ne l'est pas, alors que le cercle de 100 km
 * qu'on choisirait sur TOUTES les offres l'aurait gardée.
 */
describe.skipIf(!enabled)('D-515 §2 — le cercle de la section 2, et la route HTTP', () => {
  const PX = 'd515-prox-';
  const MX = `${PX}maison`;
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: PX } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: PX } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: PX } } });
    await viderVilles(prisma);
    oublierVilles();
    await initializeSearchIndex();
    while (await drainSearchIndex()) { /* index à jour */ }
  };
  const creer = async (id: string, ville: string, heure: number, employmentTerm: string | null) => {
    const lien = `https://example.com/${PX}${id}`;
    const entree = new Date(Date.UTC(2026, 8, 29, heure));
    await prisma.job.create({ data: { id: `${PX}${id}`, companyId: MX, source: 'GENERIC_JSONLD', externalId: `${PX}${id}`, title: 'Conseiller de vente',
      url: lien, countryCode: 'FR', city: ville, isActive: true, postedAt: entree, firstSeenAt: entree, employmentTerm,
      sources: { create: { sourceKey: 'd515-prox', sourceTier: 'ATS_OFFICIAL', externalId: `${PX}${id}`, url: lien, isActive: true,
        ...publicationFixture({ sourceKey: 'd515-prox', sourceTier: 'ATS_OFFICIAL', externalId: `${PX}${id}`, url: lien, title: 'Conseiller de vente', country: 'FR' }) } } } });
  };
  beforeAll(async () => {
    await nettoyer();
    await semerVilles(prisma);
    await prisma.company.create({ data: { id: MX, name: MX, canonicalKey: MX, fashionjobsUrl: `resolved:${MX}`, sector: 'LUXURY' } });
    for (let i = 0; i < 20; i++) await creer(`cdi-${String(i).padStart(2, '0')}`, 'Paris', 1, 'PERMANENT');
    await creer('rien-creteil', 'Créteil', 10, null);
    await creer('rien-fontainebleau', 'Fontainebleau', 11, null);
    while (await drainSearchIndex()) { /* index à jour */ }
  }, 120_000);
  afterAll(nettoyer);

  const filtres = (): JobFilters => ({ marche: 'FR', lieu: 'Paris', proximite: true, fraicheur: true, comprendre: true, nonPrecisees: true,
    filtres: { maison: [MX], contrat: ['PERMANENT'] } });
  const court = (ids: { id: string }[]) => ids.map((j) => j.id.slice(PX.length));
  const km = (a: string, b: string) => {
    const [p, q] = [a, b].map((n) => VILLES_TEMOINS.find((v) => v.name === n && v.pays === 'FR')!);
    const r = (x: number) => (x * Math.PI) / 180;
    const h = Math.sin(r(q.lat - p.lat) / 2) ** 2 + Math.cos(r(p.lat)) * Math.cos(r(q.lat)) * Math.sin(r(q.lon - p.lon) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  };

  it('PRÉMISSE : Créteil est à moins de 15 km de Paris, Fontainebleau entre 15 et 100 km ; les offres ont leur point', async () => {
    expect(km('Paris', 'Créteil')).toBeLessThan(15);
    expect(km('Paris', 'Fontainebleau')).toBeGreaterThan(50);
    expect(km('Paris', 'Fontainebleau')).toBeLessThan(100);
    expect(await prisma.job.count({ where: { id: { startsWith: PX }, geoSource: 'CITY' } })).toBe(22);
  });

  it('les deux sections : vingt CDI, puis l’incomplète de Créteil ; celle de Fontainebleau, hors du cercle, jamais', async () => {
    const e = await examinerAlerte(filtres(), FILIGRANE, BORNE_PUBLICATION);
    expect(e.jobs).toHaveLength(20);
    expect(court(e.jobsIncompletes!)).toEqual(['rien-creteil']);
  });

  it('que des incomplètes : aucune certaine nouvelle, la section 2 seule, dans le même cercle', async () => {
    const e = await examinerAlerte(filtres(), new Date(Date.UTC(2026, 8, 29, 5)), BORNE_PUBLICATION);
    expect(e.nouvelles).toBe(0);
    expect(e.total).toBe(20);
    expect(court(e.jobsIncompletes!)).toEqual(['rien-creteil']);
    expect(e.incompletes).toBe(1);
  });

  it('HTTP, contrat 2 : `jobsIncompletes[].dimensions` et `chemin` ; contrat 1 : ni l’un ni l’autre champ', async () => {
    vi.stubEnv('CATALOGUE_API_KEY_BACKEND', 'cle-du-backend');
    try {
      const { GET } = await import('../../app/api/alertes/examen/route');
      const appel = (client?: string) => GET(new NextRequest(`http://catalogue.test/api/alertes/examen?marche=FR&lieu=Paris&maison=${MX}&contrat=PERMANENT`
        + '&entreeApres=2026-09-29T00:00:00Z&publieeApres=2026-09-01T00:00:00Z',
      { headers: { authorization: 'Bearer cle-du-backend', ...(client ? { 'x-catwalks-client': client } : {}) } }));
      const v2 = await (await appel('2')).json();
      expect(v2.jobsIncompletes.map((j: { id: string; dimensions: string[]; chemin: string }) => [j.id.slice(PX.length), j.dimensions, j.chemin.startsWith('/emplois/')]))
        .toEqual([['rien-creteil', ['contrat'], true]]);
      expect(v2.incompletes).toBe(1);
      expect(v2.jobs.every((j: { id: string }) => j.id.startsWith(`${PX}cdi-`))).toBe(true);
      const v1 = await (await appel()).json();
      expect('jobsIncompletes' in v1).toBe(false);
      expect('incompletes' in v1).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
