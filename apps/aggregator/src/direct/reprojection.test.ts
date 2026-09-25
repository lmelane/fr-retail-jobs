import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lireOffre } from './contrat.js';
import { consommerFlux, reprojeterLigne, reprojeterStock, type SourceFlux } from './feed.js';
import { offreBrute, page } from './fixture.js';
import { projeterOffreDirecte } from './projection.js';
import { CORRESPONDANCE_DIRECTE_VERSION } from './vocabulaire.js';

/**
 * D-455 — LE STOCK SUIT LA CORRESPONDANCE, SUR UNE VRAIE BASE.
 *
 * Le flux ne re-projette une offre que lorsque le backend en publie une version plus récente. Une ligne écrite par la
 * version 1 de la correspondance (l'univers pour employeur : « Mode, Luxe », « Maison confidentielle ») doit pourtant
 * afficher « Catwalks » : elle est re-projetée depuis son contrat conservé, sans le backend, avant chaque lecture du
 * flux, et sans que change sa version, sa séquence, son éligibilité ni sa provenance. Base jetable seulement.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);

const P = 'reproj-temoin-';

describe.skipIf(!enabled)('re-projection du stock des offres directes (D-455)', () => {
  const prisma = new PrismaClient();
  const nettoyer = () => prisma.directOffer.deleteMany({ where: { id: { startsWith: P } } });
  beforeAll(nettoyer);
  afterAll(async () => {
    await nettoyer();
    await prisma.$disconnect();
  });

  /**
   * Une ligne telle que la version 1 l'a écrite : `ancien` pour employeur, dans la colonne et dans le texte indexé, que la
   * version 1 composait sans ligne d'univers (formule de `texteRecherche` à la version 1).
   */
  const ligneVersion1 = async (id: string, surcharges: Record<string, unknown>, ancien: string, eligible = true) => {
    const offre = lireOffre(offreBrute({ id, slug: `slug-${id}`, ...surcharges }));
    const ligne = projeterOffreDirecte(offre, BigInt(7), BigInt(3));
    const texteV1 = [offre.titre, ancien, offre.metier?.libelle ?? '', offre.lieu.libelle, offre.lieu.ville ?? '', offre.lieu.codePostal ?? '',
      offre.description.poste, offre.description.missions, offre.description.profil].filter(Boolean).join('\n');
    await prisma.directOffer.create({ data: { ...ligne, eligible, company: ancien, searchText: texteV1, correspondanceVersion: 1 } });
    return ligne;
  };
  const lire = (id: string) => prisma.directOffer.findUniqueOrThrow({ where: { id } });

  const A = `${P}mandat-univers`, B = `${P}mandat-retire`, C = `${P}dior`, D = `${P}illisible`, E = `${P}a-jour`, F = `${P}a-jour-illisible`;

  it('PRÉMISSE puis preuve — trois lignes de version 1 sont re-projetées depuis leur contrat, et rien d’autre ne change', async () => {
    const a = await ligneVersion1(A, { maison: null, univers: ['MODE', 'LUXE'] }, 'Mode, Luxe');
    await ligneVersion1(B, { maison: null, univers: [] }, 'Maison confidentielle', false);
    await ligneVersion1(C, { maison: { nom: 'Dior', slug: 'dior' } }, 'Dior');
    // Un contrat conservé devenu illisible : il n'est pas re-projeté, son identifiant est rendu.
    await ligneVersion1(D, { maison: null }, 'Mode, Luxe');
    await prisma.directOffer.update({ where: { id: D }, data: { payload: { version: 1, id: D } } });
    // Une ligne déjà à la version courante n'est pas relue : ni réécrite, ni signalée même si son contrat est illisible.
    await prisma.directOffer.create({ data: projeterOffreDirecte(lireOffre(offreBrute({ id: E, slug: `slug-${E}`, maison: null })), BigInt(8), BigInt(1)) });
    await prisma.directOffer.create({ data: { ...projeterOffreDirecte(lireOffre(offreBrute({ id: F, slug: `slug-${F}` })), BigInt(9), BigInt(1)), payload: {} } });
    const eAvant = await lire(E);
    expect(await lire(F)).toMatchObject({ correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION, payload: {} });

    // PRÉMISSE : quatre lignes de ce jeu sont à la version 1, dont une qui nomme son employeur par l'univers.
    expect(CORRESPONDANCE_DIRECTE_VERSION).toBeGreaterThan(1);
    expect(await prisma.directOffer.count({ where: { id: { startsWith: P }, correspondanceVersion: 1 } })).toBe(4);
    expect(await lire(A)).toMatchObject({ company: 'Mode, Luxe', correspondanceVersion: 1 });
    // Le déclencheur de la base normalise le texte indexé (minuscules, sans accents) : il se compare sous cette forme.
    expect((await lire(A)).searchText.split('\n')[1]).toBe('mode, luxe');

    expect(await reprojeterStock(prisma)).toEqual({ reprojetees: 3, nonReprojetees: [{ id: D, cause: 'ContratInvalideError' }] });

    const apresA = await lire(A);
    expect(apresA).toMatchObject({ company: 'Catwalks', correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION, eligible: true, version: BigInt(3), appliedSeq: BigInt(7), payloadHash: a.payloadHash });
    // L'employeur est « Catwalks » ; l'univers reste un mot de secteur, sur sa propre ligne après le métier (version 3).
    expect(apresA.searchText.split('\n')[1]).toBe('catwalks');
    expect(apresA.searchText.split('\n')[3]).toBe('mode, luxe');
    // Une offre retirée garde son inéligibilité ; sa dernière projection nomme « Catwalks ».
    expect(await lire(B)).toMatchObject({ company: 'Catwalks', correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION, eligible: false });
    expect(await lire(C)).toMatchObject({ company: 'Dior', maisonSlug: 'dior', correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION });
    expect(await lire(D)).toMatchObject({ company: 'Mode, Luxe', correspondanceVersion: 1 });
    expect((await lire(E)).updatedAt).toEqual(eAvant.updatedAt);
  });

  it('idempotente : une seconde passe ne relit que l’illisible, qui reste signalé', async () => {
    expect(await reprojeterStock(prisma)).toEqual({ reprojetees: 0, nonReprojetees: [{ id: D, cause: 'ContratInvalideError' }] });
  });

  it('le consommateur du flux la lance avant de lire : un flux vide suffit à mettre le stock à jour', async () => {
    await prisma.directOffer.update({ where: { id: A }, data: { company: 'Mode, Luxe', correspondanceVersion: 1 } });
    const vide: SourceFlux = { async lire() { return page([], null); } };
    const stats = await consommerFlux(prisma, vide);
    expect(stats.reprojection).toEqual({ reprojetees: 1, nonReprojetees: [{ id: D, cause: 'ContratInvalideError' }] });
    expect(stats).toMatchObject({ pages: 1, evenements: 0 });
    expect(await lire(A)).toMatchObject({ company: 'Catwalks', correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION });
  });

  it('une version plus récente écrite entre la lecture et l’écriture n’est jamais écrasée par un contrat périmé', async () => {
    const G = `${P}concurrente`;
    const p1 = await ligneVersion1(G, { maison: null, titre: 'Titre P1' }, 'Mode, Luxe');
    const lue = { id: G, payload: p1.payload as never, payloadHash: p1.payloadHash };
    // Entre la lecture et l'écriture, un processus plus ancien (correspondance 1) écrit une version plus récente, P2.
    const p2 = projeterOffreDirecte(lireOffre(offreBrute({ id: G, slug: `slug-${G}`, maison: null, titre: 'Titre P2 plus récent' })), BigInt(20), BigInt(4));
    await prisma.directOffer.update({ where: { id: G }, data: { ...p2, company: 'Mode, Luxe', correspondanceVersion: 1 } });
    // PRÉMISSE : la ligne porte maintenant un autre contrat que celui qui a été lu, et reste à la version 1.
    expect(p2.payloadHash).not.toBe(p1.payloadHash);
    expect(await lire(G)).toMatchObject({ title: 'Titre P2 plus récent', payloadHash: p2.payloadHash, correspondanceVersion: 1, version: BigInt(4) });

    expect(await reprojeterLigne(prisma, lue)).toBe(0);
    expect(await lire(G)).toMatchObject({ title: 'Titre P2 plus récent', payloadHash: p2.payloadHash, correspondanceVersion: 1 });
    // La passe suivante relit le contrat courant, P2, et le re-projette.
    await reprojeterStock(prisma);
    expect(await lire(G)).toMatchObject({ title: 'Titre P2 plus récent', company: 'Catwalks', correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION, version: BigInt(4), appliedSeq: BigInt(20) });
  });

  it('une ligne dont le contrat ne se projette plus ne bloque ni les autres lignes, ni la lecture du flux', async () => {
    const H = `${P}montant-refuse`, I = `${P}voisine`;
    await ligneVersion1(H, { maison: null }, 'Mode, Luxe');
    // Un montant négatif passe la lecture du contrat, mais la base refuse de le stocker (`storedAmount`).
    const refuse = lireOffre(offreBrute({ id: H, slug: `slug-${H}`, maison: null, salaire: { min: -1, max: null, devise: 'EUR', texte: null } }));
    await prisma.directOffer.update({ where: { id: H }, data: { payload: refuse as never } });
    await ligneVersion1(I, { maison: null }, 'Mode, Luxe');
    // PRÉMISSE : le contrat de H se lit, mais sa projection lève une erreur qui n'est pas une erreur de contrat.
    expect(() => projeterOffreDirecte(refuse, BigInt(1), BigInt(1))).toThrow();

    const vide: SourceFlux = { async lire() { return page([], null); } };
    const stats = await consommerFlux(prisma, vide);
    expect(stats.reprojection.nonReprojetees).toEqual(expect.arrayContaining([{ id: H, cause: 'Error' }]));
    expect(stats).toMatchObject({ pages: 1, evenements: 0 });
    expect(await lire(I)).toMatchObject({ company: 'Catwalks', correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION });
    expect(await lire(H)).toMatchObject({ company: 'Mode, Luxe', correspondanceVersion: 1 });
  });
});
