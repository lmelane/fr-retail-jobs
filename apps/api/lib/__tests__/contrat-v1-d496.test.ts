import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NextRequest } from 'next/server';
import { prisma } from '@catwalks/db';
import { exigerPerimetre } from '../perimetre';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { examinerAlerte, getJobStatus, getJobs, type JobFilters } from '../jobs';
import { suggestCities } from '../suggestions';
import { semerVilles, viderVilles } from '../__fixtures__/villes';
import { drainSearchIndex, initializeSearchIndex } from '../search-index';

/**
 * D-496 — LE CONTRAT D'AVANT, À L'IDENTIQUE, POUR UN CLIENT QUI N'ANNONCE PAS LA PROXIMITÉ.
 *
 * La production sert catwalks.io (branche `main` du site), qui ne connaît ni « Paris (75) » ni les cercles ; la
 * préversion du site interroge la même API. Sans l'en-tête `x-catwalks-client: 2` (contrat-client.ts), l'API doit
 * répondre comme avant le lot : mêmes offres, même ordre, mêmes totaux, mêmes facettes, mêmes curseurs, mêmes
 * suggestions, même examen d'alerte, même fiche — alors que la base porte la base de villes et que les déclencheurs ont
 * écrit le point de chaque offre.
 *
 * LE TÉMOIN EST DIFFÉRENTIEL. `__temoins__/contrat-v1-d496.json` a été écrit par le code d'AVANT le lot (agrégateur
 * `c6cde06`, ce fichier et `__fixtures__/villes.ts` copiés dans une copie de travail de ce commit, sur une base neuve
 * migrée jusqu'au lot, `ECRIRE_TEMOIN_CONTRAT_V1=1`) ; le code courant doit rendre exactement le même document.
 * Écarté du document : ce qui dépend des autres témoins de la même base (`totalPerimetre`, les options des facettes
 * hors du groupe témoin) et de la taxonomie qu'ils y publient (le métier reconnu d'une offre et la facette « Métier » ;
 * pour la même raison, aucune recherche par mot-clé : son interprétation suit la taxonomie). Rien de cela ne touche au
 * lieu, que ce lot change.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const P = 'v1-d496-';
const MAISON = `${P}maison`;
const GROUPE = 'Groupe Contrat V1 D496';
const TEMOIN = join(__dirname, '__temoins__', 'contrat-v1-d496.json');

type Offre = { ville: string; pays?: string; adminArea1?: string; point?: [number, number]; code?: string; titre?: string;
  contrat?: string; teletravail?: boolean; publiee: string };
const OFFRES: readonly Offre[] = [
  { ville: 'Paris', point: [48.8566, 2.3522], code: '75001', titre: 'Conseiller de vente', contrat: 'CDI', publiee: '2026-09-01' },
  { ville: 'Paris', point: [48.8606, 2.3376], code: '75001', titre: 'Vendeur joaillerie', contrat: 'CDD', publiee: '2026-09-02' },
  { ville: 'Paris 9e Arrondissement', code: '75009', titre: 'Conseiller de vente', contrat: 'CDI', publiee: '2026-09-03' },
  { ville: 'Chennevières-sur-Marne', code: '94430', titre: 'Responsable boutique', contrat: 'CDI', publiee: '2026-09-04' },
  { ville: 'Champigny-sur-Marne', titre: 'Conseiller de vente', contrat: 'CDI', publiee: '2026-09-05' },
  { ville: 'Créteil', titre: 'Vendeur', contrat: 'CDD', publiee: '2026-09-06' },
  { ville: 'Lyon', point: [45.764, 4.8357], titre: 'Conseiller de vente', contrat: 'CDI', publiee: '2026-09-07' },
  { ville: 'Vienne', titre: 'Vendeur', contrat: 'CDI', publiee: '2026-09-08' },
  { ville: 'Paris', titre: 'Styliste', contrat: 'CDI', teletravail: true, publiee: '2026-09-09' },
  { ville: 'New York', pays: 'US', adminArea1: 'NY', point: [40.7128, -74.006], titre: 'Sales Advisor', publiee: '2026-09-10' },
  { ville: 'Brooklyn', pays: 'US', adminArea1: 'NY', titre: 'Sales Associate', publiee: '2026-09-11' },
  { ville: 'Austin', pays: 'US', adminArea1: 'TX', titre: 'Sales Advisor', publiee: '2026-09-12' },
  { ville: 'London', pays: 'GB', titre: 'Sales Advisor', publiee: '2026-09-13' },
  { ville: 'Hounslow', pays: 'GB', titre: 'Client Advisor', publiee: '2026-09-14' },
  // Assez d'offres à Paris et autour pour qu'une recherche tienne sur deux pages : le curseur servi est exercé.
  ...Array.from({ length: 24 }, (_v, i): Offre => ({ ville: i % 3 === 0 ? 'Créteil' : 'Paris', titre: i % 2 ? 'Vendeur' : 'Conseiller de vente',
    contrat: i % 4 ? 'CDI' : 'CDD', publiee: `2026-08-${String(i + 1).padStart(2, '0')}` })),
];
const DIRECTES = [{ id: 'paris', ville: 'Paris' }, { id: 'champigny', ville: 'Champigny-sur-Marne' }] as const;

/** Les recherches représentatives, sans le signal : sans lieu, avec un lieu, des formes que seul le nouveau contrat lit. */
const RECHERCHES: Record<string, Partial<JobFilters>> = {
  'FR sans critère': { marche: 'FR' },
  'FR Paris': { marche: 'FR', lieu: 'Paris' },
  'FR Chennevières-sur-Marne': { marche: 'FR', lieu: 'Chennevières-sur-Marne' },
  'FR « Paris (75) », forme du nouveau contrat': { marche: 'FR', lieu: 'Paris (75)' },
  'FR « Paris 9e Arrondissement »': { marche: 'FR', lieu: 'Paris 9e Arrondissement' },
  'FR code postal 94430': { marche: 'FR', lieu: '94430' },
  'FR filtre ville paris + lyon (accueil, alertes)': { marche: 'FR', filtres: { ville: ['paris', 'lyon'] } },
  'FR Lyon et un contrat': { marche: 'FR', lieu: 'Lyon', filtres: { contrat: ['CDI'] } },
  'FR télétravail': { marche: 'FR', lieu: 'Télétravail' },
  'FR pays du visiteur': { marche: 'FR', prioritePays: 'FR' },
  'US New York': { marche: 'US', lieu: 'New York' },
  'GB London': { marche: 'GB', lieu: 'London' },
};

describe.skipIf(!enabled)('sans le signal du client, le contrat d’avant le lot (D-496)', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: P } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: P } } });
    await viderVilles(prisma);
    await initializeSearchIndex();
    while (await drainSearchIndex()) { /* index à jour */ }
  };

  beforeAll(async () => {
    await nettoyer();
    // La base de villes chargée AVANT les offres : les déclencheurs écrivent le point de chacune, comme en production.
    await semerVilles(prisma);
    await prisma.company.create({ data: { id: MAISON, name: MAISON, canonicalKey: MAISON, fashionjobsUrl: `resolved:${MAISON}`, sector: 'LUXURY', parentGroup: GROUPE } });
    for (const [i, o] of OFFRES.entries()) {
      const id = `${P}${String(i).padStart(2, '0')}`;
      const pays = o.pays ?? 'FR';
      const titre = o.titre ?? 'Conseiller de vente';
      const lien = `https://example.com/${id}`;
      await prisma.job.create({ data: { id, companyId: MAISON, externalId: id, source: 'GENERIC_JSONLD', title: titre, url: lien, isActive: true,
        countryCode: pays, city: o.ville, adminArea1: o.adminArea1 ?? null, postalCode: o.code ?? null, location: o.ville,
        latitude: o.point?.[0] ?? null, longitude: o.point?.[1] ?? null, employmentTerm: o.contrat ?? null,
        workplaceType: o.teletravail ? 'REMOTE' : null,
        postedAt: new Date(`${o.publiee}T08:00:00Z`), firstSeenAt: new Date(`${o.publiee}T09:00:00Z`), lastSeenAt: new Date('2026-09-20T00:00:00Z') } });
      await prisma.jobSource.create({ data: { jobId: id, sourceKey: 'v1-d496', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, isActive: true,
        ...publicationFixture({ sourceKey: 'v1-d496', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, title: titre, country: pays }) } });
    }
    for (const d of DIRECTES) {
      await prisma.directOffer.create({ data: {
        id: `${P}directe-${d.id}`, version: BigInt(1), appliedSeq: BigInt(1), eligible: true, payloadHash: 'temoin', payload: {},
        correspondanceVersion: 1, slug: `v1-d496-directe-${d.id}`, title: 'Conseiller de vente', company: MAISON, companyId: MAISON,
        countryCode: 'FR', city: d.ville, location: d.ville, language: 'fr', description: 'Conseiller de vente',
        applyUrl: `https://catwalks.io/offres/v1-d496-directe-${d.id}`, postedAt: new Date('2026-09-01T00:00:00Z'),
        modifiedAt: new Date('2026-09-01T00:00:00Z'), receivedAt: new Date('2026-09-01T00:00:00Z'), searchText: 'Conseiller de vente' } });
    }
    while (await drainSearchIndex()) { /* index à jour */ }
  }, 120_000);
  afterAll(nettoyer);

  /** Le document de la recherche, sans ce que d'autres témoins de la même base peuvent changer. */
  const DEPEND_DE_LA_BASE = new Set(['totalPerimetre', 'occupationCode', 'occupationLabel', 'occupationStatus', 'occupationFamilyLabel', 'titleRoles']);
  const documenter = (valeur: unknown): unknown => JSON.parse(JSON.stringify(valeur, (cle, v) => {
    if (DEPEND_DE_LA_BASE.has(cle)) return undefined;
    if (cle === 'facettes' && Array.isArray(v)) return v.filter((f: { cle?: unknown }) => f.cle !== 'metier');
    if (v && typeof v === 'object' && !Array.isArray(v) && (v as { cle?: unknown }).cle === 'groupe') {
      const f = v as { options?: Array<{ value: string }> };
      return { ...f, options: (f.options ?? []).filter((o) => o.value === GROUPE) };
    }
    return v;
  }));
  const avecGroupe = (f: Partial<JobFilters>): JobFilters => ({ ...f, filtres: { groupe: [GROUPE], ...f.filtres } });

  const constituer = async () => {
    const recherches: Record<string, unknown> = {};
    for (const [nom, f] of Object.entries(RECHERCHES)) {
      // Deux pages de 25 au plus : la suite par le curseur servi, qui doit rester le même jeton.
      const premiere = await getJobs(avecGroupe(f));
      const seconde = premiere.suivant ? await getJobs({ ...avecGroupe(f), apres: premiere.suivant }) : null;
      recherches[nom] = { premiere, seconde };
    }
    const fr = exigerPerimetre('FR');
    const suggestions = {
      'FR Pa': await suggestCities('Pa', fr), 'FR Ch': await suggestCities('Ch', fr), 'FR Paris': await suggestCities('Paris', fr),
      'US New': await suggestCities('New', exigerPerimetre('US')), 'GB Lon': await suggestCities('Lon', exigerPerimetre('GB')),
    };
    const examens = {
      'FR Paris': await examinerAlerte(avecGroupe({ marche: 'FR', lieu: 'Paris' }), new Date('2026-09-02T00:00:00Z'), new Date('2026-08-01T00:00:00Z')),
      'FR ville chennevières-sur-marne': await examinerAlerte(avecGroupe({ marche: 'FR', filtres: { ville: ['chennevières-sur-marne'] } }),
        new Date('2026-08-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z')),
    };
    const fiches = { agregee: await getJobStatus(`${P}00`), directe: await getJobStatus(`cw_${P}directe-paris`) };
    return documenter({ recherches, suggestions, examens, fiches });
  };

  it('PRÉMISSE : la base porte la base de villes, et les déclencheurs ont donné un point aux offres qui n’en avaient pas', async () => {
    expect(await prisma.job.count({ where: { id: { startsWith: P }, geoSource: 'CITY' } })).toBeGreaterThan(5);
    expect(await prisma.directOffer.count({ where: { id: { startsWith: `${P}directe-` }, geoSource: 'CITY' } })).toBe(DIRECTES.length);
  });

  it('TÉMOIN DIFFÉRENTIEL : recherches, curseurs, suggestions, examens et fiches rendent le document du code d’avant le lot', async () => {
    const document = await constituer();
    if (process.env.ECRIRE_TEMOIN_CONTRAT_V1 === '1') {
      mkdirSync(dirname(TEMOIN), { recursive: true });
      writeFileSync(TEMOIN, `${JSON.stringify(document, null, 2)}\n`);
      return;
    }
    expect(existsSync(TEMOIN), 'le document du code d’avant le lot').toBe(true);
    expect(document).toEqual(JSON.parse(readFileSync(TEMOIN, 'utf8')));
  });

  it('la route : sans l’en-tête, le contrat d’avant ; avec `x-catwalks-client: 2`, la proximité et les lieux reconnus', async () => {
    vi.stubEnv('CATALOGUE_API_KEY', 'cle-du-site');
    try {
      const { GET: rechercher } = await import('../../app/api/jobs/route');
      const { GET: suggerer } = await import('../../app/api/suggest/route');
      const appel = (chemin: string, client?: string) => new NextRequest(`http://catalogue.test${chemin}`,
        { headers: { authorization: 'Bearer cle-du-site', ...(client ? { 'x-catwalks-client': client } : {}) } });
      const chemin = `/api/jobs?marche=FR&groupe=${encodeURIComponent(GROUPE)}&lieu=${encodeURIComponent('Chennevières-sur-Marne')}`;
      const sans = await (await rechercher(appel(chemin))).json();
      expect(sans.total).toBe(1);
      expect(sans.lieu).toEqual((await getJobs(avecGroupe({ marche: 'FR', lieu: 'Chennevières-sur-Marne' }))).lieu);
      for (const autre of ['1', 'deux', ' ']) expect((await (await rechercher(appel(chemin, autre))).json()).total, autre).toBe(1);
      const avec = await (await rechercher(appel(chemin, '2'))).json();
      expect(avec.total).toBeGreaterThan(1);
      expect(avec.lieu).toEqual({ type: 'ville', libelle: 'Chennevières-sur-Marne (94)' });
      const villes = '/api/suggest?type=city&q=Pari&marche=FR';
      expect((await (await suggerer(appel(villes))).json()).suggestions).toEqual(await suggestCities('Pari', exigerPerimetre('FR')));
      expect((await (await suggerer(appel(villes, '2'))).json()).suggestions[0]).toBe('Paris (75)');
      // L'examen d'une alerte (clé du backend) : la même règle.
      vi.stubEnv('CATALOGUE_API_KEY_BACKEND', 'cle-du-backend');
      const { GET: examiner } = await import('../../app/api/alertes/examen/route');
      const examen = (client?: string) => examiner(new NextRequest(`http://catalogue.test${chemin.replace('/api/jobs', '/api/alertes/examen')}`
        + '&entreeApres=2026-08-01T00:00:00Z&publieeApres=2026-08-01T00:00:00Z',
      { headers: { authorization: 'Bearer cle-du-backend', ...(client ? { 'x-catwalks-client': client } : {}) } }));
      expect((await (await examen()).json()).total).toBe(1);
      expect((await (await examen('2')).json()).total).toBe(avec.total);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
