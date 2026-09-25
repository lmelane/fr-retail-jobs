import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { publicJobWhere } from '@catwalks/db/availability';
import { lireOffre } from '../../../aggregator/src/direct/contrat';
import { offreBrute, contexteTemoin } from '../../../aggregator/src/direct/fixture';
import { projeterOffreDirecte } from '../../../aggregator/src/direct/projection';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { directPubliable } from '../direct-offers';
import { getJobStatus, getSimilarJobs, type JobRow } from '../jobs';

/**
 * D-456 §4 (R-96) — LES MANDATS CATWALKS SORTENT DU BLOC « MÊME EMPLOYEUR » DES OFFRES SIMILAIRES. Sur une vraie base,
 * par la chaîne réelle : la projection de l'agrégateur écrit l'employeur affiché (« Catwalks » pour un mandat sans Maison
 * publique, D-455 §1), `getSimilarJobs` de l'API compose la liste.
 *
 * Avant D-456, la fiche d'un mandat proposait d'abord les autres mandats du pays, quel que soit le métier, puisque tous
 * portent le même employeur affiché. Désormais elle passe directement au remplissage : même secteur, même ville, même
 * pays. Les fiches des Maisons, directes comme agrégées, gardent leurs offres de la même Maison.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);

const P = 'similairesD456';
const A = 'similaires-d456';
const MAISON = 'Maison Similaires Témoin D456';
const MAISON_ID = `${A}-maison`;
const SECTEUR_ID = `${A}-secteur`;
const CATWALKS_ID = `${A}-catwalks`;
const PREUVE = [{ code: 'FASHION', source: 'https://example.com/officiel', statement: 'Témoin D-456', confidence: 'HIGH', basis: 'OFFICIAL_SOURCE', checkedAt: '2026-09-25T00:00:00Z' }];
const MANIFESTE = { reviewer: 'temoin-d456', companies: [{ id: SECTEUR_ID, canonicalKey: SECTEUR_ID, codes: ['FASHION'], evidence: PREUVE }] };
// Une revue de secteur est immuable (déclencheur `sector_review_immutable`) : identifiée par son contenu, créée une
// seule fois ; un manifeste modifié en crée une autre au lieu de heurter l'ancienne.
const REVUE = `${A}-revue-${createHash('sha256').update(JSON.stringify(MANIFESTE)).digest('hex').slice(0, 16)}`;

const PARIS = { libelle: 'Paris 8e, France', ville: 'Paris', arrondissement: '8e', codePostal: '75008', pays: 'FR', latitude: 48.87, longitude: 2.31 };
const LYON = { libelle: 'Lyon, France', ville: 'Lyon', arrondissement: null, codePostal: '69002', pays: 'FR', latitude: 45.76, longitude: 4.83 };
const directe = (id: string, maison: { nom: string; slug: string } | null, univers: string[], lieu: typeof PARIS | typeof LYON, publieeLe: string) =>
  offreBrute({ id: `${P}${id}`, slug: `${A}-${id.toLowerCase()}`, anciensSlugs: [], maison, univers, specialisations: [], lieu, publieeLe });
const DIRECTES = [
  directe('MandatParis', null, ['MODE'], PARIS, '2026-09-10T08:00:00.000Z'),
  directe('MandatParisBis', null, ['MODE'], PARIS, '2026-09-12T08:00:00.000Z'),
  directe('MandatLyon', null, ['BEAUTE'], LYON, '2026-09-11T08:00:00.000Z'),
  directe('MaisonParis', { nom: MAISON, slug: 'maison-similaires-d456' }, ['MODE'], PARIS, '2026-09-09T08:00:00.000Z'),
  directe('MaisonLyon', { nom: MAISON, slug: 'maison-similaires-d456' }, ['MODE'], LYON, '2026-09-08T08:00:00.000Z'),
];
type Agregee = { id: string; companyId: string; ville: string; pays: string; posteLe: string };
const AGREGEES: readonly Agregee[] = [
  { id: 'maison-paris', companyId: MAISON_ID, ville: 'Paris', pays: 'FR', posteLe: '2026-09-07' },
  { id: 'maison-lyon', companyId: MAISON_ID, ville: 'Lyon', pays: 'FR', posteLe: '2026-09-06' },
  { id: 'secteur-paris', companyId: SECTEUR_ID, ville: 'Paris', pays: 'FR', posteLe: '2026-09-05' },
  { id: 'secteur-lyon', companyId: SECTEUR_ID, ville: 'Lyon', pays: 'FR', posteLe: '2026-09-04' },
  { id: 'secteur-paris-us', companyId: SECTEUR_ID, ville: 'Paris', pays: 'US', posteLe: '2026-09-03' },
  { id: 'catwalks-paris', companyId: CATWALKS_ID, ville: 'Paris', pays: 'FR', posteLe: '2026-09-02' },
];
const cw = (id: string) => `cw_${P}${id}`;
const agg = (id: string) => `${A}-${id}`;

async function fiche(id: string): Promise<JobRow> {
  const statut = await getJobStatus(id);
  if (statut.status !== 'active') throw new Error(`${id} : fiche active attendue, reçu ${statut.status}`);
  return statut.job;
}
const similaires = async (id: string) => (await getSimilarJobs(await fiche(id), 6)).map((j) => j.id);

describe.skipIf(!enabled)('offres similaires : un mandat Catwalks passe directement au remplissage (D-456 §4)', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: A } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: A } } });
    await prisma.company.deleteMany({ where: { id: { in: [MAISON_ID, SECTEUR_ID, CATWALKS_ID] } } });
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: P } } });
  };
  beforeAll(async () => {
    await nettoyer();
    await prisma.sectorReview.createMany({ skipDuplicates: true, data: [{ id: REVUE, reviewer: MANIFESTE.reviewer, before: [], manifest: MANIFESTE }] });
    await prisma.company.create({ data: { id: MAISON_ID, name: MAISON, canonicalKey: MAISON_ID, fashionjobsUrl: `resolved:${MAISON_ID}` } });
    await prisma.company.create({ data: { id: SECTEUR_ID, name: 'Maison Secteur Mode D456', canonicalKey: SECTEUR_ID, fashionjobsUrl: `resolved:${SECTEUR_ID}`,
      sectorCodes: ['FASHION'], sectorEvidence: PREUVE, sectorReviewId: REVUE } });
    // Une société agrégée qui s'appellerait « Catwalks » : le registre n'en connaît aucune aujourd'hui (mesuré le 24/09),
    // mais l'étape agrégée du bloc « même employeur » la proposerait sur la fiche d'un mandat.
    await prisma.company.create({ data: { id: CATWALKS_ID, name: 'Catwalks', canonicalKey: CATWALKS_ID, fashionjobsUrl: `resolved:${CATWALKS_ID}` } });
    for (const g of AGREGEES) {
      const titre = `Conseiller de vente ${g.id}`;
      const lien = `https://example.com/${A}/${g.id}`;
      await prisma.job.create({ data: {
        id: agg(g.id), companyId: g.companyId, source: 'GENERIC_JSONLD', externalId: g.id, title: titre, url: lien, city: g.ville, countryCode: g.pays,
        language: 'fr', isActive: true, postedAt: new Date(g.posteLe), firstSeenAt: new Date(g.posteLe),
        sources: { create: { sourceKey: A, sourceTier: 'ATS_OFFICIAL', externalId: g.id, url: lien, isActive: true,
          ...publicationFixture({ sourceKey: A, sourceTier: 'ATS_OFFICIAL', externalId: g.id, url: lien, title: titre, city: g.ville,
            country: g.pays, language: 'fr', postedAt: new Date(g.posteLe) }) } },
      } });
    }
    for (const brute of DIRECTES) await prisma.directOffer.create({ data: projeterOffreDirecte(lireOffre(brute), BigInt(1), BigInt(1), contexteTemoin()) });
  }, 120_000);
  afterAll(nettoyer);

  it('PRÉMISSE — le bloc « même employeur » d’un mandat trouverait deux autres mandats et une offre agrégée « Catwalks » en France', async () => {
    const mandat = await fiche(cw('MandatParis'));
    expect(mandat).toMatchObject({ origine: 'CATWALKS', company: 'Catwalks', city: 'Paris', sectorCodes: ['FASHION'] });
    expect(await prisma.directOffer.count({ where: { id: { startsWith: P }, company: 'Catwalks', countryCode: 'FR', ...directPubliable() } })).toBe(3);
    expect(await prisma.job.count({ where: { ...publicJobWhere(), countryCode: 'FR', company: { name: 'Catwalks' } } })).toBe(1);
    // Le remplissage est exact : une seule offre publiable de la mode à Paris, en France, dans toute la base.
    expect(await prisma.job.count({ where: { ...publicJobWhere(), countryCode: 'FR', city: { equals: 'Paris', mode: 'insensitive' },
      company: { sectorCodes: { has: 'FASHION' } } } })).toBe(1);
  });

  it('la fiche d’un mandat ne propose ni les autres mandats ni l’employeur « Catwalks » : même secteur, même ville, même pays', async () => {
    const ids = await similaires(cw('MandatParis'));
    for (const autre of [cw('MandatParisBis'), cw('MandatLyon'), agg('catwalks-paris')]) expect(ids, `${autre} parmi ${ids.join(', ')}`).not.toContain(autre);
    expect(ids).toEqual([agg('secteur-paris')]);
  });

  it('la fiche d’une Maison ne change pas : offre directe, ses offres de la même Maison d’abord, puis le remplissage', async () => {
    expect(await similaires(cw('MaisonParis'))).toEqual([cw('MaisonLyon'), agg('maison-paris'), agg('maison-lyon'), agg('secteur-paris')]);
  });

  it('la fiche agrégée d’une Maison ne change pas : ses offres Catwalks d’abord, puis ses offres agrégées', async () => {
    expect(await similaires(agg('maison-paris'))).toEqual([cw('MaisonParis'), cw('MaisonLyon'), agg('maison-lyon')]);
  });
});
