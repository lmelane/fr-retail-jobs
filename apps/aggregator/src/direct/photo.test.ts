import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chargerContexte, type ContexteProjection } from './contexte.js';
import { offreListe } from './fixture.js';
import { LISTE_PLAFOND, ListeIndisponibleError, ListeInvalideError, type SourceListe } from './liste.js';
import { ETAT_LISTE, passeReussie, synchroniserListe, type StatsPhoto } from './photo.js';
import { CORRESPONDANCE_DIRECTE_VERSION } from './vocabulaire.js';

/**
 * D-444 — LA PHOTO DE LA LISTE PUBLIQUE, SUR UNE VRAIE BASE. Présente : publiable ; absente d'une photo complète :
 * retirée, projection gardée ; vide, tronquée ou illisible : aucun retrait ; panne : rien d'écrit. Et rien n'est écrit
 * qui n'a pas changé. Le contexte est le vrai (registre de la base, taxonomie active, tracé des frontières).
 * Base jetable seulement.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);

const P = 'photoD444';
const S = 'photo-d444-';
const MAISON = 'Maison Photo Témoin';
const GROUPE = 'Groupe Photo Témoin';
/** Une génération de recherche propre au témoin : ses entrées en file se comptent sans celles des autres générations. */
const GENERATION = 'search-temoin-photo';

/** Une offre de la liste, identifiée dans l'espace du témoin. */
const offre = (id: string, surcharges: Record<string, unknown> = {}) =>
  offreListe({ id: `${P}${id}`, slug: `${S}${id.toLowerCase()}`, maison: { name: MAISON, slug: 'maison-photo-temoin' }, ...surcharges });
/** Une liste servie et le compte que le backend annonce (`/api/jobs/filters`) : par défaut, celui de la liste servie. */
const source = (reponse: unknown, annoncees?: number | Error): SourceListe => ({
  async lire() { return structuredClone(reponse); },
  async compter() {
    if (annoncees instanceof Error) throw annoncees;
    return { contractTypes: [{ value: 'CDI', count: annoncees ?? (Array.isArray(reponse) ? reponse.length : 0) }] };
  },
});
const panne: SourceListe = { async lire() { throw new ListeIndisponibleError(503, 'HTTP 503'); }, async compter() { return { contractTypes: [] }; } };

describe.skipIf(!enabled)('la photo des offres Catwalks (D-444)', () => {
  const prisma = new PrismaClient();
  let contexte: ContexteProjection;
  const lignes = () => prisma.directOffer.findMany({ where: { id: { startsWith: P } }, orderBy: { id: 'asc' } });
  const ligne = (id: string) => prisma.directOffer.findUniqueOrThrow({ where: { id: `${P}${id}` } });
  const nettoyer = async () => {
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.directFeedCursor.deleteMany({ where: { id: ETAT_LISTE } });
    await prisma.companyAlias.deleteMany({ where: { companyId: { startsWith: S } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: S }, mergedIntoId: { not: null } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: S } } });
    await prisma.searchPending.deleteMany({ where: { id: { startsWith: `cw_${P}` } } });
  };
  // Paris (avec Maison du registre), Nice (mandat), New York, Monaco : les coordonnées de la liste de production.
  const BASE = [
    offre('Paris'),
    offre('Nice', { maison: null, title: 'Responsable de boutique', location: 'Nice — avenue de Verdun', latitude: 43.6963773, longitude: 7.2676739 }),
    offre('NewYork', { title: 'Store Manager', location: 'New York — Madison Avenue', latitude: 40.7422083, longitude: -73.9869957 }),
    offre('Monaco', { title: 'Conseiller de vente', location: 'Monaco — Carré d’Or', latitude: 43.73841760000001, longitude: 7.424615799999999 }),
  ];

  beforeAll(async () => {
    await nettoyer();
    await prisma.company.create({ data: { id: `${S}maison`, name: MAISON, canonicalKey: `${S}maison`, fashionjobsUrl: `resolved:${S}maison`, parentGroup: GROUPE } });
    // Une génération de recherche est enregistrée : ses déclencheurs mettent en file toute offre qui change.
    await prisma.searchGeneration.upsert({ where: { version: GENERATION }, create: { version: GENERATION }, update: {} });
    contexte = await chargerContexte(prisma);
  }, 60_000);
  afterAll(async () => {
    await nettoyer();
    await prisma.searchGeneration.deleteMany({ where: { version: GENERATION } });
    await prisma.$disconnect();
  });

  it('première passe : chaque offre présente entre, publiable, avec son pays, son employeur, son groupe et son métier', async () => {
    const stats = await synchroniserListe(prisma, source(BASE), { contexte });
    expect(stats).toMatchObject({ recues: 4, lues: 4, complete: true, publiees: 4, inchangees: 0, retirees: 0, parPays: { FR: 2, US: 1, MC: 1 }, abstentions: [] });
    // Monaco n'est servi par aucun marché de /emplois : l'offre entre, publiable, et la passe la signale.
    expect(stats.horsMarche).toEqual([{ id: `${P}Monaco`, lieu: 'Monaco — Carré d’Or', pays: 'MC' }]);
    const paris = await ligne('Paris');
    expect(paris).toMatchObject({ eligible: true, countryCode: 'FR', company: MAISON, companyId: `${S}maison`, correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION,
      applyUrl: `https://catwalks.io/offres/${S}paris`, city: null, postalCode: null, version: BigInt(0), appliedSeq: BigInt(0) });
    // Le métier vient de la taxonomie active, appliquée à l'intitulé.
    expect(paris.occupationCode).toBe(contexte.metier('Conseiller de vente H/F').occupationCode);
    expect(paris.occupationCode).not.toBeNull();
    // Le mandat : « Catwalks », aucun rattachement ; Nice est en France, Monaco à Monaco.
    expect(await ligne('Nice')).toMatchObject({ company: 'Catwalks', companyId: null, maisonSlug: null, countryCode: 'FR' });
    expect(await ligne('Monaco')).toMatchObject({ countryCode: 'MC' });
    expect(await ligne('NewYork')).toMatchObject({ countryCode: 'US' });
    expect(await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: ETAT_LISTE } })).toMatchObject({ lastError: null });
  });

  it('une liste inchangée n’écrit AUCUNE offre et ne met rien en file d’indexation', async () => {
    const paris = await ligne('Paris');
    await prisma.searchPending.deleteMany({ where: { id: { startsWith: `cw_${P}` } } });
    // PRÉMISSE : les déclencheurs de la recherche mettent bien en file une offre qui change (sinon ce témoin ne prouve rien).
    await prisma.directOffer.update({ where: { id: paris.id }, data: { title: 'Titre modifié à la main' } });
    expect(await prisma.searchPending.count({ where: { version: GENERATION, id: `cw_${P}Paris` } })).toBe(1);
    await prisma.directOffer.update({ where: { id: paris.id }, data: { title: paris.title } });
    await prisma.searchPending.deleteMany({ where: { id: { startsWith: `cw_${P}` } } });
    const reference = await lignes();

    const stats = await synchroniserListe(prisma, source(BASE), { contexte });
    expect(stats).toMatchObject({ complete: true, publiees: 0, misesAJour: 0, retablies: 0, inchangees: 4, retirees: 0 });
    expect((await lignes()).map((l) => l.updatedAt)).toEqual(reference.map((l) => l.updatedAt));
    expect(await prisma.searchPending.count({ where: { version: GENERATION, id: { startsWith: `cw_${P}` } } })).toBe(0);
  });

  it('une offre modifiée est réécrite, elle seule', async () => {
    const reference = await lignes();
    const stats = await synchroniserListe(prisma, source([BASE[0], { ...BASE[1], title: 'Directeur de boutique' }, BASE[2], BASE[3]]), { contexte });
    expect(stats).toMatchObject({ misesAJour: 1, inchangees: 3 });
    const apres = await lignes();
    expect(apres.find((l) => l.id === `${P}Nice`)?.title).toBe('Directeur de boutique');
    expect(apres.filter((l, i) => l.updatedAt.getTime() !== reference[i].updatedAt.getTime()).map((l) => l.id)).toEqual([`${P}Nice`]);
    await synchroniserListe(prisma, source(BASE), { contexte });
  });

  it('absente d’une photo complète : retirée, projection gardée ; revenue : rétablie', async () => {
    const stats = await synchroniserListe(prisma, source([BASE[0], BASE[2], BASE[3]]), { contexte });
    expect(stats).toMatchObject({ complete: true, retirees: 1, inchangees: 3 });
    expect(await ligne('Nice')).toMatchObject({ eligible: false, title: 'Responsable de boutique', company: 'Catwalks', countryCode: 'FR' });
    const retour = await synchroniserListe(prisma, source(BASE), { contexte });
    expect(retour).toMatchObject({ retablies: 1, retirees: 0 });
    expect(await ligne('Nice')).toMatchObject({ eligible: true });
  });

  it('une réponse vide ne retire rien, et la passe le dit', async () => {
    const stats = await synchroniserListe(prisma, source([]), { contexte });
    expect(stats).toMatchObject({ complete: false, motifIncomplet: 'VIDE', retirees: 0, retraitsSuspendus: 4 });
    expect((await lignes()).every((l) => l.eligible)).toBe(true);
    expect((await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: ETAT_LISTE } })).lastError).toMatch(/^VIDE/);
  });

  it(`une réponse au plafond (${LISTE_PLAFOND}) est peut-être tronquée : ses offres sont écrites, aucune absente n'est retirée`, async () => {
    // PRÉMISSE : les offres du témoin sont absentes de cette réponse, qui compte exactement le plafond du backend.
    const pleine = Array.from({ length: LISTE_PLAFOND }, (_, i) => offre(`Plein${i}`, { title: `Conseiller de vente ${i}` }));
    expect(pleine).toHaveLength(LISTE_PLAFOND);
    expect(pleine.some((o) => BASE.some((b) => b.id === o.id))).toBe(false);
    const stats = await synchroniserListe(prisma, source(pleine), { contexte });
    expect(stats).toMatchObject({ complete: false, motifIncomplet: 'TRONQUEE', publiees: LISTE_PLAFOND, retirees: 0, retraitsSuspendus: 4 });
    expect((await prisma.directOffer.findMany({ where: { id: { in: BASE.map((b) => String(b.id)) } } })).every((l) => l.eligible)).toBe(true);
    // Une liste sous le plafond est complète : les 500 de passage sont retirées, les quatre de la base restent.
    expect(await synchroniserListe(prisma, source(BASE), { contexte })).toMatchObject({ complete: true, retirees: LISTE_PLAFOND });
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: `${P}Plein` } } });
  }, 60_000);

  it('une liste plus courte que le compte du backend (pagination, plafond abaissé) ne retire rien : troncature sous le plafond', async () => {
    // PRÉMISSE : la liste servie ne porte qu'une des quatre offres, et elle est bien sous le plafond de 500.
    expect(1).toBeLessThan(LISTE_PLAFOND);
    const stats = await synchroniserListe(prisma, source([BASE[0]], 4), { contexte });
    expect(stats).toMatchObject({ complete: false, motifIncomplet: 'COMPTE_DIFFERENT', recues: 1, annoncees: 4, retirees: 0, retraitsSuspendus: 3 });
    expect((await lignes()).every((l) => l.eligible)).toBe(true);
    // Sans compte lisible, la complétude n'est pas prouvée : rien n'est retiré non plus.
    const sansCompte = await synchroniserListe(prisma, source([BASE[0]], new ListeIndisponibleError(502, 'HTTP 502')), { contexte });
    expect(sansCompte).toMatchObject({ complete: false, motifIncomplet: 'COMPTE_INDISPONIBLE', annoncees: null, retirees: 0 });
    // La cause du compte manquant est gardée pour l'alerte, jamais un simple « indisponible ».
    expect(sansCompte.compteErreur).toMatch(/HTTP 502/);
    expect((await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: ETAT_LISTE } })).lastError).toMatch(/^COMPTE_INDISPONIBLE.*HTTP 502/);
    const compteIllisible = await synchroniserListe(prisma, { ...source([BASE[0]]), async compter() { return { contractTypes: 'beaucoup' }; } }, { contexte });
    expect(compteIllisible).toMatchObject({ complete: false, motifIncomplet: 'COMPTE_INDISPONIBLE', retirees: 0 });
    expect((await lignes()).every((l) => l.eligible)).toBe(true);
    expect((await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: ETAT_LISTE } })).lastError).toMatch(/^COMPTE_INDISPONIBLE/);
    await synchroniserListe(prisma, source(BASE), { contexte });
  });

  it('une offre illisible ne retire rien ; les offres lisibles sont écrites ; l’offre refusée reste telle quelle', async () => {
    const stats = await synchroniserListe(prisma, source([{ ...BASE[0], title: 'Paris mis à jour' }, { ...BASE[2], status: 'OFFLINE' }]), { contexte });
    expect(stats).toMatchObject({ complete: false, motifIncomplet: 'OFFRES_REFUSEES', misesAJour: 1, retirees: 0, retraitsSuspendus: 2 });
    expect(stats.refusees).toEqual([expect.objectContaining({ index: 1, id: `${P}NewYork`, chemin: 'liste[1].status' })]);
    expect(await ligne('Paris')).toMatchObject({ title: 'Paris mis à jour', eligible: true });
    expect(await ligne('NewYork')).toMatchObject({ title: 'Store Manager', eligible: true });
    expect(await ligne('Nice')).toMatchObject({ eligible: true });
    await synchroniserListe(prisma, source(BASE), { contexte });
  });

  it('une panne du backend ou une réponse invalide n’écrit rien dans les offres : la copie est figée, l’erreur gardée', async () => {
    const reference = await lignes();
    await expect(synchroniserListe(prisma, panne, { contexte })).rejects.toBeInstanceOf(ListeIndisponibleError);
    expect((await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: ETAT_LISTE } })).lastError).toMatch(/indisponible/);
    await expect(synchroniserListe(prisma, source({ erreur: 'maintenance' }), { contexte })).rejects.toBeInstanceOf(ListeInvalideError);
    await expect(synchroniserListe(prisma, source([BASE[0], BASE[0]]), { contexte })).rejects.toThrow(/servi deux fois/);
    expect((await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: ETAT_LISTE } })).lastError).toMatch(/invalide/);
    expect(await lignes()).toEqual(reference);
  });

  it('le pays s’abstient quand les coordonnées manquent ou tombent hors du tracé : l’offre entre sans pays', async () => {
    const stats = await synchroniserListe(prisma, source([...BASE, offre('SansPoint', { latitude: null, longitude: null }), offre('EnMer', { latitude: 43.6, longitude: 7.3 })]), { contexte });
    expect(stats.abstentions).toEqual([
      { id: `${P}SansPoint`, lieu: 'Paris 8e — avenue Montaigne', motif: 'COORDONNEES_ABSENTES' },
      { id: `${P}EnMer`, lieu: 'Paris 8e — avenue Montaigne', motif: 'HORS_TRACE' },
    ]);
    expect(await ligne('SansPoint')).toMatchObject({ eligible: true, countryCode: null });
    expect(await ligne('EnMer')).toMatchObject({ eligible: true, countryCode: null });
    await synchroniserListe(prisma, source(BASE), { contexte });
    await prisma.directOffer.deleteMany({ where: { id: { in: [`${P}SansPoint`, `${P}EnMer`] } } });
  });

  it('le rattachement au registre de la base : nom à l’accent et à l’apostrophe près ; un nom ambigu ne rattache rien', async () => {
    // Fusions et alias revus exigent une revue d'identité en base : leur lecture est prouvée par `contexte.test.ts`.
    await prisma.company.create({ data: { id: `${S}occitane`, name: 'L’Occitane en Provence', canonicalKey: `${S}occitane`, fashionjobsUrl: `resolved:${S}occitane`, parentGroup: 'L’Occitane Groupe' } });
    await prisma.company.create({ data: { id: `${S}double-a`, name: 'Maison Double', canonicalKey: `${S}double-a`, fashionjobsUrl: `resolved:${S}double-a` } });
    await prisma.company.create({ data: { id: `${S}double-b`, name: 'MAISON DOUBLE', canonicalKey: `${S}double-b`, fashionjobsUrl: `resolved:${S}double-b` } });
    const ctx = await chargerContexte(prisma);
    expect(ctx.rattacher("L'Occitane en Provence")).toBe(`${S}occitane`);
    expect(ctx.rattacher('Maison Double')).toBeNull();
    expect(ctx.rattacher(null)).toBeNull();
    const stats = await synchroniserListe(prisma, source([...BASE, offre('Occitane', { maison: { name: "L'Occitane en Provence", slug: 'l-occitane-en-provence' } }),
      offre('Double', { maison: { name: 'Maison Double', slug: 'maison-double' } })]), { contexte: ctx });
    expect(stats.publiees).toBe(2);
    expect(await ligne('Occitane')).toMatchObject({ company: "L'Occitane en Provence", companyId: `${S}occitane` });
    expect(await ligne('Double')).toMatchObject({ company: 'Maison Double', companyId: null });
    await prisma.directOffer.deleteMany({ where: { id: { in: [`${P}Occitane`, `${P}Double`] } } });
    await prisma.company.deleteMany({ where: { id: { in: [`${S}occitane`, `${S}double-a`, `${S}double-b`] } } });
  });

  it('la correspondance antérieure est re-projetée avant la photo, sans version ni éligibilité touchées', async () => {
    await prisma.directOffer.update({ where: { id: `${P}Nice` }, data: { correspondanceVersion: 3, companyId: 'ancien', occupationCode: null } });
    const stats = await synchroniserListe(prisma, source(BASE), { contexte });
    expect(stats.reprojection).toEqual({ reprojetees: 1, nonReprojetees: [] });
    expect(await ligne('Nice')).toMatchObject({ correspondanceVersion: CORRESPONDANCE_DIRECTE_VERSION, companyId: null, eligible: true });
  });

  it('une photo lue avant une autre déjà écrite est périmée : elle n’écrit rien par-dessus la plus récente', async () => {
    // La passe A lit la liste où Nice est encore présente ; avant qu'elle n'écrive, la passe B lit une liste où Nice a
    // disparu, et l'écrit. A arrive ensuite : elle ne doit ni rétablir Nice, ni rien réécrire.
    let libererA!: () => void;
    let lectureA!: () => void;
    const attenteA = new Promise<void>((resolve) => { libererA = resolve; });
    const debutA = new Promise<void>((resolve) => { lectureA = resolve; });
    const lenteA: SourceListe = { async lire() { lectureA(); await attenteA; return structuredClone(BASE); }, async compter() { return { contractTypes: [{ value: 'CDI', count: BASE.length }] }; } };
    const passeA = synchroniserListe(prisma, lenteA, { contexte });
    // A a pris son instant de lecture et attend la réponse du backend.
    await debutA;
    const passeB = await synchroniserListe(prisma, source([BASE[0], BASE[2], BASE[3]]), { contexte });
    // PRÉMISSE : B a bien retiré Nice, et A a commencé sa lecture avant B.
    expect(passeB).toMatchObject({ complete: true, retirees: 1, perimee: false });
    const apresB = await lignes();
    libererA();
    const resultatA = await passeA;
    expect(resultatA).toMatchObject({ perimee: true, publiees: 0, misesAJour: 0, retablies: 0, retirees: 0 });
    // Une passe périmée n'a rien écrit : elle échoue, pour que sa répétition se voie.
    expect(passeReussie(resultatA)).toBe(false);
    expect(await lignes()).toEqual(apresB);
    expect(await ligne('Nice')).toMatchObject({ eligible: false });
    await synchroniserListe(prisma, source(BASE), { contexte });
    expect(await ligne('Nice')).toMatchObject({ eligible: true });
  });

  it('deux passes simultanées n’en font qu’une : celle qui ne tient pas le verrou n’écrit rien', async () => {
    const reference = await lignes();
    const resultat = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('catwalks-direct-liste', 0))::text`;
      return synchroniserListe(prisma, source([BASE[0]]), { contexte });
    }, { timeout: 60_000 });
    expect(resultat).toMatchObject({ concurrente: true, retirees: 0 });
    expect(passeReussie(resultat)).toBe(false);
    expect(await lignes()).toEqual(reference);
  });

  it('l’instant de lecture est pris à l’horloge de la base : une machine à l’horloge en avance ne fige pas le lecteur', async () => {
    const reelle = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // PRÉMISSE : l'horloge de ce processus a un jour d'avance sur la base.
      vi.setSystemTime(reelle + 86_400_000);
      expect(Date.now()).toBeGreaterThan(reelle + 86_000_000);
      expect(await synchroniserListe(prisma, source(BASE), { contexte })).toMatchObject({ complete: true, perimee: false });
    } finally {
      vi.useRealTimers();
    }
    const etat = await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: ETAT_LISTE } });
    expect(etat.lastReadAt.getTime()).toBeLessThan(Date.now() + 60_000);
    // Une passe à l'heure juste n'est pas prise pour périmée : le lecteur n'est pas figé.
    const suivante = await synchroniserListe(prisma, source(BASE), { contexte });
    expect(suivante).toMatchObject({ perimee: false, complete: true });
    expect(passeReussie(suivante)).toBe(true);
  });

  it('une passe en panne, plus ancienne qu’une passe déjà écrite, ne fait reculer ni l’instant ni l’état du lecteur', async () => {
    let echouerA!: (e: Error) => void;
    let lectureA!: () => void;
    const debutA = new Promise<void>((resolve) => { lectureA = resolve; });
    const lenteA: SourceListe = {
      lire() { lectureA(); return new Promise((_, reject) => { echouerA = reject; }); },
      async compter() { return { contractTypes: [] }; },
    };
    const passeA = synchroniserListe(prisma, lenteA, { contexte });
    await debutA;
    const passeB = await synchroniserListe(prisma, source(BASE), { contexte });
    const apresB = await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: ETAT_LISTE } });
    // PRÉMISSE : B, plus récente, a écrit une photo complète, sans erreur.
    expect(passeReussie(passeB)).toBe(true);
    expect(apresB.lastError).toBeNull();
    echouerA(new ListeIndisponibleError(503, 'HTTP 503'));
    await expect(passeA).rejects.toBeInstanceOf(ListeIndisponibleError);
    const apresA = await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: ETAT_LISTE } });
    expect(apresA.lastReadAt).toEqual(apresB.lastReadAt);
    expect(apresA.lastError).toBeNull();
    // Une panne plus récente, elle, est notée.
    await expect(synchroniserListe(prisma, panne, { contexte })).rejects.toBeInstanceOf(ListeIndisponibleError);
    const apresPanne = await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: ETAT_LISTE } });
    expect(apresPanne.lastReadAt.getTime()).toBeGreaterThan(apresB.lastReadAt.getTime());
    expect(apresPanne.lastError).toMatch(/indisponible/);
    await synchroniserListe(prisma, source(BASE), { contexte });
  });
});

describe('une passe réussie (D-444)', () => {
  const base = { complete: true, perimee: false, concurrente: false, reprojection: { reprojetees: 0, nonReprojetees: [] } } as unknown as StatsPhoto;
  it('exige une photo complète, écrite, sans ligne laissée à sa projection antérieure', () => {
    expect(passeReussie(base)).toBe(true);
    expect(passeReussie({ ...base, complete: false })).toBe(false);
    expect(passeReussie({ ...base, perimee: true })).toBe(false);
    expect(passeReussie({ ...base, concurrente: true })).toBe(false);
    expect(passeReussie({ ...base, reprojection: { reprojetees: 0, nonReprojetees: [{ id: 'x', cause: 'Error' }] } })).toBe(false);
  });
});
