import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { lireOffre } from '../../../aggregator/src/direct/contrat';
import { contexteTemoin, offreBrute } from '../../../aggregator/src/direct/fixture';
import { projeterOffreDirecte } from '../../../aggregator/src/direct/projection';
import { reprojeterStock } from '../../../aggregator/src/direct/feed';
import { CORRESPONDANCE_DIRECTE_VERSION } from '../../../aggregator/src/direct/vocabulaire';
import { drainSearchIndex, initializeSearchIndex } from '../search-index';
import { searchWords } from '../search-intent';
import { getJobs } from '../jobs';

/**
 * D-455 §1 — LA RECHERCHE RETROUVE UNE OFFRE CATWALKS PAR SON UNIVERS, sans que l'univers nomme l'employeur. Sur une
 * vraie base, par la chaîne réelle : la projection de l'agrégateur, l'index de recherche de l'API, `getJobs`.
 *
 * La version 1 de la projection nommait l'employeur d'un mandat sans Maison publique par son univers (« Mode, Luxe ») :
 * la recherche « luxe » le trouvait par ce faux nom d'employeur. D-455 §1 l'a remplacé par « Catwalks » ; les libellés
 * d'univers restent des mots de SECTEUR de l'offre, cherchables, jamais un employeur.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);

const P = 'rechercheUniversD455';
const MAISON = { nom: 'Maison Recherche Témoin', slug: 'maison-recherche-temoin' };
// Un texte sans aucun des mots cherchés : seul l'univers peut les porter.
const NEUTRE = {
  titre: 'Conseiller de vente', metier: { slug: 'conseiller-vente', libelle: 'Conseiller de vente' }, specialisations: [],
  description: { marque: 'Une Maison française.', poste: 'Accueillir les clients en boutique et les conseiller.', missions: 'Conseil, vente, suivi des clients.',
    profil: 'Trois ans d’expérience en boutique.', avantages: null },
};
const OFFRES = [
  { id: 'ModeLuxe', maison: null, univers: ['MODE', 'LUXE'] },
  { id: 'Beaute', maison: null, univers: ['BEAUTE'] },
  { id: 'Luxe', maison: null, univers: ['LUXE'] },
  { id: 'Maison', maison: MAISON, univers: ['MODE', 'LUXE'] },
];
const cw = (id: string) => `cw_${P}${id}`;
const trouvees = async (q: string) => (await getJobs({ marche: 'FR', q, filtres: {} })).jobs.map((j) => j.id).filter((id) => id.startsWith(`cw_${P}`)).sort();

describe.skipIf(!enabled)('la recherche retrouve une offre Catwalks par son univers (D-455 §1)', () => {
  const nettoyer = () => prisma.directOffer.deleteMany({ where: { id: { startsWith: P } } });
  beforeAll(async () => {
    await nettoyer();
    for (const o of OFFRES) {
      const brute = offreBrute({ ...NEUTRE, id: `${P}${o.id}`, slug: `${P.toLowerCase()}-${o.id.toLowerCase()}`, anciensSlugs: [], maison: o.maison, univers: o.univers });
      await prisma.directOffer.create({ data: projeterOffreDirecte(lireOffre(brute), BigInt(1), BigInt(1), contexteTemoin()) });
    }
    await initializeSearchIndex();
    while (await drainSearchIndex()) {}
  }, 120_000);
  afterAll(nettoyer);

  it('PRÉMISSE — ni l’intitulé, ni l’employeur affiché, ni le lieu, ni la description ne portent « mode », « beauté » ou « luxe »', async () => {
    const lignes = await prisma.directOffer.findMany({ where: { id: { startsWith: P } }, select: { title: true, company: true, location: true, city: true, description: true, occupationLabel: true } });
    expect(lignes).toHaveLength(OFFRES.length);
    for (const l of lignes) {
      const mots = searchWords([l.title, l.company, l.location, l.city, l.description, l.occupationLabel].join(' '));
      for (const mot of ['mode', 'beaute', 'luxe']) expect(mots, `${l.company} : ${mot}`).not.toContain(mot);
    }
    expect(lignes.filter((l) => l.company === 'Catwalks')).toHaveLength(3);
  });

  it('« luxe » trouve les offres de l’univers Luxe, avec ou sans Maison publique', async () => {
    expect(await trouvees('luxe')).toEqual([cw('Luxe'), cw('Maison'), cw('ModeLuxe')]);
  });

  it('« mode » et « beauté » trouvent les offres de leur univers, et elles seules', async () => {
    expect(await trouvees('mode')).toEqual([cw('Maison'), cw('ModeLuxe')]);
    expect(await trouvees('beauté')).toEqual([cw('Beaute')]);
  });

  it('« mode luxe » exige les deux univers', async () => {
    expect(await trouvees('mode luxe')).toEqual([cw('Maison'), cw('ModeLuxe')]);
  });

  it('l’univers n’est jamais un employeur : le filtre Maison « Luxe » ne trouve rien, « Catwalks » trouve les trois mandats', async () => {
    const parMaison = async (maison: string) => (await getJobs({ marche: 'FR', filtres: { maison: [maison] } })).jobs.map((j) => j.id).filter((id) => id.startsWith(`cw_${P}`)).sort();
    expect(await parMaison('Luxe')).toEqual([]);
    expect(await parMaison('Mode, Luxe')).toEqual([]);
    expect(await parMaison('Catwalks')).toEqual([cw('Beaute'), cw('Luxe'), cw('ModeLuxe')]);
  });

  it('une re-projection du stock qui ne change que le texte indexé repasse par la file : l’univers atteint la recherche', async () => {
    // PRÉMISSE : une offre restée à la correspondance 2, dont le texte indexé ne porte pas encore son univers, et dont
    // aucune autre colonne suivie par l'index ne changera à la re-projection.
    const v3 = projeterOffreDirecte(lireOffre(offreBrute({ ...NEUTRE, id: `${P}Stock`, slug: `${P.toLowerCase()}-stock`, anciensSlugs: [], maison: null, univers: ['LUXE'] })), BigInt(1), BigInt(1), contexteTemoin());
    const texteV2 = v3.searchText.split('\n').filter((ligne) => ligne !== 'Luxe').join('\n');
    expect(texteV2).not.toBe(v3.searchText);
    await prisma.directOffer.create({ data: { ...v3, correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION - 1, searchText: texteV2 } });
    while (await drainSearchIndex()) {}
    expect(await trouvees('luxe')).not.toContain(cw('Stock'));

    await reprojeterStock(prisma, contexteTemoin());
    expect(await prisma.directOffer.findUniqueOrThrow({ where: { id: `${P}Stock` }, select: { correspondanceVersion: true } })).toEqual({ correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION });
    while (await drainSearchIndex()) {}
    expect(await trouvees('luxe')).toContain(cw('Stock'));
  });
});
