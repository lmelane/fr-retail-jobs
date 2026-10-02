import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { examinerAlerte, getJobs, getJobStatus, getSimilarJobs, type JobFilters } from '../jobs';
import { CurseurInvalideError } from '../curseur';
import { oublierVilles } from '../geo';
import { semerVilles, viderVilles, VILLES_TEMOINS } from '../__fixtures__/villes';
import { drainSearchIndex, initializeSearchIndex } from '../search-index';
import { fraicheurDe, trierParFraicheur } from '../fraicheur';

/**
 * D-510 (décision du CEO, 02/10/2026) — LES OFFRES SONT TRIÉES PAR FRAÎCHEUR, au contrat 2 (`x-catwalks-client: 2`) :
 * Catwalks d'abord, puis la plus fraîche (`LEAST(postedAt, firstSeenAt)`, `fraicheur.ts`), puis l'identifiant. La
 * distance et la pertinence retiennent les offres ; elles ne les trient plus. Sur une vraie base, par la vraie chaîne
 * (`getJobs`, `examinerAlerte`, `getSimilarJobs`). Chaque témoin affirme d'abord que sa situation REMPLIT la condition du
 * défaut (l'ordre d'avant serait un autre ordre), puis l'ordre servi.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const P = 'fr-d510-';
const M = { prox: `${P}prox`, cw: `${P}cw`, mot: `${P}mot`, page: `${P}page`, sim: `${P}sim`, sim2: `${P}sim2` } as const;
/** Le secteur commun de la fiche et du remplissage des offres similaires, posé par une revue de secteur (immuable :
 * identifiée par son contenu, créée une seule fois). */
const SECTEUR = 'WATCHMAKING';
const PREUVE = [{ code: SECTEUR, source: 'https://example.com/officiel', statement: 'Témoin D-510', confidence: 'HIGH', basis: 'OFFICIAL_SOURCE', checkedAt: '2026-10-02T00:00:00Z' }];
const MANIFESTE = { reviewer: 'temoin-d510', companies: [M.sim, M.sim2].map((id) => ({ id, canonicalKey: id, codes: [SECTEUR], evidence: PREUVE })) };
const REVUE = `${P}revue-${createHash('sha256').update(JSON.stringify(MANIFESTE)).digest('hex').slice(0, 16)}`;
const jour = (iso: string) => new Date(`${iso}T08:00:00Z`);
const PARIS = VILLES_TEMOINS.find((v) => v.name === 'Paris' && v.pays === 'FR')!;

type Offre = { id: string; maison: string; titre?: string; ville?: string; point?: [number, number]; description?: string;
  postedAt: Date | null; firstSeenAt: Date };

/** Le témoin de pagination : des égalités de fraîcheur à cheval sur les pages, des offres sans date et republiées. */
const PAGE: Offre[] = Array.from({ length: 60 }, (_v, i): Offre => {
  const id = `${P}page-${String(i).padStart(2, '0')}`;
  // 0-29 : la même date (égalités, départagées par l'identifiant, sur deux pages) ; 30-44 : une date chacune ;
  // 45-52 : sans date, entrées récemment ; 53-59 : republiées (date postérieure à la première observation).
  if (i < 30) return { id, maison: M.page, postedAt: jour('2026-09-10'), firstSeenAt: jour('2026-09-20') };
  if (i < 45) return { id, maison: M.page, postedAt: jour(`2026-08-${String(i - 25).padStart(2, '0')}`), firstSeenAt: jour('2026-09-20') };
  if (i < 53) return { id, maison: M.page, postedAt: null, firstSeenAt: jour(`2026-09-${String(i - 22).padStart(2, '0')}`) };
  return { id, maison: M.page, postedAt: jour('2026-09-30'), firstSeenAt: jour(`2026-07-${String(i - 40).padStart(2, '0')}`) };
});

const OFFRES: Offre[] = [
  // Proximité : à 2 km de Paris, ancienne ; à Meaux (41 km), récente.
  { id: `${P}prox-pres`, maison: M.prox, ville: 'Paris', point: [PARIS.lat + 0.018, PARIS.lon], postedAt: jour('2026-08-01'), firstSeenAt: jour('2026-09-20') },
  { id: `${P}prox-loin`, maison: M.prox, ville: 'Meaux', postedAt: jour('2026-09-28'), firstSeenAt: jour('2026-09-28') },
  // Origines : une offre agrégée récente face à une offre Catwalks ancienne (créée plus bas).
  { id: `${P}cw-agregee`, maison: M.cw, postedAt: jour('2026-09-29'), firstSeenAt: jour('2026-09-29') },
  // Mot-clé : l'ancienne nomme le mot dans son intitulé ; la récente ne l'a que dans sa description.
  { id: `${P}mot-pertinente`, maison: M.mot, titre: 'Conseiller zibeline', postedAt: jour('2026-08-01'), firstSeenAt: jour('2026-09-20') },
  { id: `${P}mot-recente`, maison: M.mot, titre: 'Vendeur', description: 'Une boutique où chaque pièce de zibeline compte.',
    postedAt: jour('2026-09-28'), firstSeenAt: jour('2026-09-28') },
  // Similaires : l'offre de la fiche, puis la même Maison, dont une sans date entrée récemment.
  { id: `${P}sim-fiche`, maison: M.sim, postedAt: jour('2026-09-01'), firstSeenAt: jour('2026-09-20') },
  { id: `${P}sim-datee`, maison: M.sim, postedAt: jour('2026-09-15'), firstSeenAt: jour('2026-09-20') },
  { id: `${P}sim-ancienne`, maison: M.sim, postedAt: jour('2026-08-15'), firstSeenAt: jour('2026-09-20') },
  { id: `${P}sim-sans-date`, maison: M.sim, postedAt: null, firstSeenAt: jour('2026-09-29') },
  // Le remplissage (même secteur, même ville, autre Maison) : une offre agrégée plus fraîche que toute la Maison.
  { id: `${P}sim2-recente`, maison: M.sim2, postedAt: jour('2026-10-01'), firstSeenAt: jour('2026-10-01') },
  ...PAGE,
];

const directe = (suffixe: string, maison: string, postedAt: Date) => ({
  id: `${P}directe-${suffixe}`, version: BigInt(1), appliedSeq: BigInt(1), eligible: true, payloadHash: 'temoin', payload: {},
  correspondanceVersion: 1, slug: `${P}directe-${suffixe}`, title: 'Conseiller de vente', company: maison, companyId: maison,
  countryCode: 'FR', city: 'Paris', location: 'Paris', language: 'fr', description: 'Conseiller de vente',
  applyUrl: `https://catwalks.io/offres/${P}directe-${suffixe}`, postedAt, receivedAt: jour('2026-10-01'),
  modifiedAt: postedAt, searchText: 'Conseiller de vente' });

describe.skipIf(!enabled)('D-510 : le tri par fraîcheur, sur une base locale dédiée', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: P } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: P } } });
    await viderVilles(prisma);
    oublierVilles();
    await initializeSearchIndex();
    while (await drainSearchIndex()) { /* index à jour */ }
  };
  beforeAll(async () => {
    await nettoyer();
    await semerVilles(prisma);
    await prisma.sectorReview.createMany({ skipDuplicates: true, data: [{ id: REVUE, reviewer: MANIFESTE.reviewer, before: [], manifest: MANIFESTE }] });
    for (const m of Object.values(M)) {
      const secteur = m === M.sim || m === M.sim2 ? { sectorCodes: [SECTEUR], sectorEvidence: PREUVE, sectorReviewId: REVUE } : {};
      await prisma.company.create({ data: { id: m, name: m, canonicalKey: m, fashionjobsUrl: `resolved:${m}`, sector: 'LUXURY', parentGroup: 'Groupe D510', ...secteur } });
    }
    for (const o of OFFRES) {
      const lien = `https://example.com/${o.id}`, titre = o.titre ?? 'Conseiller de vente', ville = o.ville ?? 'Paris';
      await prisma.job.create({ data: { id: o.id, companyId: o.maison, externalId: o.id, source: 'GENERIC_JSONLD', title: titre, url: lien,
        isActive: true, countryCode: 'FR', city: ville, location: ville, description: o.description ?? null,
        latitude: o.point?.[0] ?? null, longitude: o.point?.[1] ?? null, postedAt: o.postedAt, firstSeenAt: o.firstSeenAt } });
      await prisma.jobSource.create({ data: { jobId: o.id, sourceKey: 'd510', sourceTier: 'ATS_OFFICIAL', externalId: o.id, url: lien, isActive: true,
        ...publicationFixture({ sourceKey: 'd510', sourceTier: 'ATS_OFFICIAL', externalId: o.id, url: lien, title: titre, country: 'FR' }) } });
    }
    await prisma.directOffer.create({ data: directe('ancienne', M.cw, jour('2026-07-01')) });
    await prisma.directOffer.create({ data: directe('sim', M.sim, jour('2026-06-01')) });
    await prisma.directOffer.create({ data: { ...directe('sim-autre', M.sim2, jour('2026-06-15')), sectorCodes: [SECTEUR] } });
    while (await drainSearchIndex()) { /* index à jour */ }
  }, 120_000);
  afterAll(nettoyer);

  /** Le contrat 2, tel que la route le pose (`x-catwalks-client: 2`) : proximité, requête comprise, fraîcheur. */
  const v2 = (maison: string, extra: Partial<JobFilters> = {}): JobFilters =>
    ({ marche: 'FR', proximite: true, comprendre: true, fraicheur: true, ...extra, filtres: { maison: [maison], ...extra.filtres } });
  /** Le contrat 1 : sans l'en-tête, l'ordre d'avant. */
  const v1 = (maison: string, extra: Partial<JobFilters> = {}): JobFilters => ({ marche: 'FR', ...extra, filtres: { maison: [maison], ...extra.filtres } });
  const ids = async (f: JobFilters) => (await getJobs(f)).jobs.map((j) => j.id);
  const toutes = async (f: JobFilters) => {
    const vus: string[] = [];
    let apres: string | undefined;
    let pages = 0;
    do {
      const r = await getJobs({ ...f, apres });
      vus.push(...r.jobs.map((j) => j.id));
      apres = r.suivant ?? undefined;
      pages++;
    } while (apres && pages < 20);
    return { ids: vus, pages };
  };

  it('avec un lieu : dans le rayon, l’offre récente à 40 km passe devant l’offre ancienne à 2 km', async () => {
    const r = await getJobs(v2(M.prox, { lieu: 'Paris (75)' }));
    // PRÉMISSE : les deux sont dans le cercle retenu (élargi faute de 20 offres), la récente est la plus éloignée.
    const points = await prisma.job.findMany({ where: { id: { in: [`${P}prox-pres`, `${P}prox-loin`] } }, select: { id: true, geoLatitude: true } });
    const lat = (id: string) => points.find((p) => p.id === id)!.geoLatitude!;
    expect(Math.abs(lat(`${P}prox-loin`) - PARIS.lat)).toBeGreaterThan(Math.abs(lat(`${P}prox-pres`) - PARIS.lat));
    expect(r.total).toBe(2);
    expect(r.jobs.map((j) => j.id)).toEqual([`${P}prox-loin`, `${P}prox-pres`]);
  });

  it('une offre Catwalks ancienne passe devant une offre agrégée récente', async () => {
    // PRÉMISSE : l'offre Catwalks est la plus ancienne des deux.
    const [d] = await prisma.directOffer.findMany({ where: { id: `${P}directe-ancienne` }, select: { postedAt: true } });
    expect(d.postedAt!.getTime()).toBeLessThan(jour('2026-09-29').getTime());
    expect(await ids(v2(M.cw))).toEqual([`cw_${P}directe-ancienne`, `${P}cw-agregee`]);
  });

  it('une recherche par mot-clé : l’offre récente moins pertinente passe devant l’offre ancienne plus pertinente', async () => {
    // PRÉMISSE : au contrat 1, la pertinence trie, et la plus pertinente (le mot dans l'intitulé) passe devant.
    expect(await ids(v1(M.mot, { q: 'zibeline' }))).toEqual([`${P}mot-pertinente`, `${P}mot-recente`]);
    // Au contrat 2, la pertinence ne fait que retenir : les deux répondent, la plus fraîche d'abord.
    expect(await ids(v2(M.mot, { q: 'zibeline' }))).toEqual([`${P}mot-recente`, `${P}mot-pertinente`]);
  });

  it('la pagination par curseur est stable : ni doublon ni trou, égalités de fraîcheur à cheval sur les pages', async () => {
    const attendu = trierParFraicheur(PAGE.map((o) => ({ ...o, origine: 'AGREGEE' })), fraicheurDe).map((o) => o.id);
    // PRÉMISSE : 30 offres de même fraîcheur couvrent la frontière entre la 1re et la 2e page (25 par page) ; l'ordre
    // de la clé d'avant (date de publication, sans date en dernier) serait un autre ordre.
    const memeFraicheur = PAGE.filter((o) => fraicheurDe(o) === jour('2026-09-10').getTime()).map((o) => o.id);
    expect(memeFraicheur).toHaveLength(30);
    const rangs = memeFraicheur.map((id) => attendu.indexOf(id));
    expect(Math.min(...rangs)).toBeLessThan(25);
    expect(Math.max(...rangs)).toBeGreaterThanOrEqual(25);
    expect(await ids(v1(M.page))).not.toEqual(attendu.slice(0, 25));
    const { ids: vus, pages } = await toutes(v2(M.page));
    expect(pages).toBe(3);
    expect(new Set(vus).size).toBe(vus.length);
    expect(vus).toEqual(attendu);
  });

  it('un curseur de l’autre ordre est refusé, jamais repris au milieu d’un ordre qui n’est pas le sien', async () => {
    const v1Page = await getJobs(v1(M.page));
    const v2Page = await getJobs(v2(M.page));
    expect(v1Page.suivant).not.toBeNull();
    await expect(getJobs({ ...v2(M.page), apres: v1Page.suivant! })).rejects.toBeInstanceOf(CurseurInvalideError);
    await expect(getJobs({ ...v1(M.page), apres: v2Page.suivant! })).rejects.toBeInstanceOf(CurseurInvalideError);
  });

  it('l’examen d’une alerte rend les nouveautés par fraîcheur, dans l’ordre de la page', async () => {
    const examen = await examinerAlerte(v2(M.page), jour('2026-01-01'), jour('2026-01-01'));
    const page = await toutes(v2(M.page));
    expect(examen.nouvelles).toBe(60);
    expect(examen.jobs.map((j) => j.id)).toEqual(page.ids.slice(0, 50));
    // PRÉMISSE : au contrat 1, une offre sans date entrée récemment passe en dernier ; au contrat 2, à sa fraîcheur.
    const avant = await examinerAlerte(v1(M.page), jour('2026-01-01'), jour('2026-01-01'));
    expect(avant.jobs.map((j) => j.id)).not.toEqual(examen.jobs.map((j) => j.id));
    expect(examen.jobs[0].id).toBe(`${P}page-52`);
  });

  it('les offres similaires : les mêmes offres et les mêmes blocs (D-470), la plus fraîche d’abord dans chacun', async () => {
    const statut = await getJobStatus(`${P}sim-fiche`);
    if (statut.status !== 'active') throw new Error('offre active attendue');
    const avant = (await getSimilarJobs(statut.job, 6, 'fr')).map((j) => j.id);
    const apres = (await getSimilarJobs(statut.job, 6, 'fr', true)).map((j) => j.id);
    // PRÉMISSE : la même Maison remplit 4 places ; le remplissage du secteur porte une offre Catwalks et une offre agrégée
    // plus fraîche que toute la Maison ; l'ordre d'avant range l'offre sans date de la Maison en dernier de son bloc.
    expect(avant).toEqual([`cw_${P}directe-sim`, `${P}sim-datee`, `${P}sim-ancienne`, `${P}sim-sans-date`, `cw_${P}directe-sim-autre`, `${P}sim2-recente`]);
    // Les mêmes offres ; D-470 §1 : la même Maison reste devant le remplissage (jamais « toutes les offres Catwalks avant
    // même les offres agrégées de la même Maison »), et la plus fraîche passe d'abord dans chaque bloc.
    expect(new Set(apres)).toEqual(new Set(avant));
    expect(apres).toEqual([`cw_${P}directe-sim`, `${P}sim-sans-date`, `${P}sim-datee`, `${P}sim-ancienne`, `cw_${P}directe-sim-autre`, `${P}sim2-recente`]);
  });
});
