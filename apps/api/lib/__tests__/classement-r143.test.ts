import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@catwalks/db';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { ENTETE_PREFERENCES, ENTETE_PREFERENCES_MAX, examinerAlerte, getJobs, parseFilters, preferencesDepuisEntete, type JobFilters, type JobRow } from '../jobs';
import { NextRequest } from 'next/server';
import { CurseurInvalideError } from '../curseur';
import { oublierVilles } from '../geo';
import { semerVilles, viderVilles, VILLES_TEMOINS } from '../__fixtures__/villes';
import { drainSearchIndex, initializeSearchIndex } from '../search-index';
import { BASE, DEMI_VIE_JOURS, POINTS, lireClassement } from '../classement';
import { loadOccupationTaxonomy, occupationTitleRoles, persistedOccupationDecision } from '@catwalks/db/occupations';

/**
 * R-143 §7 (D-513, décision du CEO du 02/10/2026, précision « une recherche tapée compte ») — LE CLASSEMENT PERTINENT, au
 * contrat 2. Sans requête ni préférences : l'ordre de D-510 (le plus frais d'abord). Avec une requête tapée, un métier
 * choisi ou des préférences : le score (`classement.ts`), la fraîcheur restant un signal fort ; une donnée inconnue ne
 * pénalise jamais comme un désaccord (R-143 §10). Sur une vraie base, par la vraie chaîne (`getJobs`, `examinerAlerte`).
 * Chaque témoin affirme d'abord que sa situation REMPLIT la condition du défaut (l'ordre de D-510 serait un autre ordre).
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const P = 'fr-r143c-';
const M = { mot: `${P}mot`, ctr: `${P}ctr`, tele: `${P}tele`, lieu: `${P}lieu`, met: `${P}met`, cw: `${P}cw`, page: `${P}page`, filtre: `${P}filtre`, sal: `${P}sal`, incl: `${P}incl` } as const;
const JOUR = 86_400_000;
const NOW = Date.now();
/** Une date à `jours` jours de l'instant du témoin. */
const il = (jours: number) => new Date(NOW - jours * JOUR);
const PARIS = VILLES_TEMOINS.find((v) => v.name === 'Paris' && v.pays === 'FR')!;
/** Le métier du témoin « métier choisi » : celui que la taxonomie de la base témoin donne à « Sales Advisor ». */
let METIER = '';

type Offre = {
  id: string; maison: string; age: number; titre?: string; description?: string; ville?: string; point?: [number, number];
  contrat?: string; programme?: string; teletravail?: string; metier?: string; roles?: string[];
  salaire?: { min: number | null; max: number | null; devise: string; periode: string };
};

/** Le témoin de pagination : 60 offres, des points différents (contrat), des égalités de score à cheval sur les pages. */
const PAGE: Offre[] = Array.from({ length: 60 }, (_v, i): Offre => ({
  id: `${P}page-${String(i).padStart(2, '0')}`, maison: M.page,
  // 0-29 : contrat inconnu, le même âge (30 scores égaux, à cheval sur la 1re page) ; 30-44 : CDI de 10 à 24 jours (les
  // six plus frais passent devant les égaux, les autres derrière) ; 45-59 : CDD (désaccord) de 1 à 15 jours.
  contrat: i < 30 ? undefined : i < 45 ? 'PERMANENT' : 'FIXED_TERM',
  age: i < 30 ? 5 : i < 45 ? 10 + (i - 30) : i - 44,
}));

const OFFRES: Offre[] = [
  // La requête tapée : l'intitulé qui la nomme (10 jours), la description seule (1 jour), l'intitulé très ancien (90 jours).
  { id: `${P}mot-titre`, maison: M.mot, age: 10, titre: 'Conseiller zibeline' },
  { id: `${P}mot-description`, maison: M.mot, age: 1, titre: 'Vendeur', description: 'Une boutique où chaque pièce de zibeline compte.' },
  { id: `${P}mot-ancienne`, maison: M.mot, age: 90, titre: 'Conseiller zibeline senior' },
  // L'écriture inclusive : l'intitulé nomme exactement « conseiller de vente ».
  // Classées comme l'agrégateur les classe : retenues par leur métier, jamais par la suite exacte des mots.
  { id: `${P}incl-inclusif`, maison: `${P}incl`, age: 4, titre: 'Conseiller·ère de vente', metier: 'classer-titre' },
  // Le métier seulement lu dans l'intitulé (pas de métier principal) : seul l'intitulé peut lui valoir 40.
  { id: `${P}incl-parenthese`, maison: `${P}incl`, age: 4, titre: 'Conseiller(e) de vente', roles: ['metier-du-temoin'] },
  // Les préférences de contrat : un CDI, un contrat inconnu, un CDD, au même âge ; un inconnu frais face à un CDI ancien.
  { id: `${P}ctr-cdi`, maison: M.ctr, age: 6, contrat: 'PERMANENT' },
  { id: `${P}ctr-inconnu`, maison: M.ctr, age: 6 },
  { id: `${P}ctr-cdd`, maison: M.ctr, age: 6, contrat: 'FIXED_TERM' },
  { id: `${P}ctr-inconnu-frais`, maison: M.ctr, age: 1 },
  { id: `${P}ctr-cdi-ancien`, maison: M.ctr, age: 20, contrat: 'PERMANENT' },
  // L'alternance en CDD se cherche comme alternance (la pastille la coche) : l'un de ses choix est voulu.
  { id: `${P}ctr-alternance`, maison: M.ctr, age: 6, contrat: 'FIXED_TERM', programme: 'APPRENTICESHIP' },
  // Le télétravail : à distance, sur site, inconnu, hybride, au même âge.
  { id: `${P}tele-distance`, maison: M.tele, age: 4, teletravail: 'REMOTE' },
  { id: `${P}tele-site`, maison: M.tele, age: 4, teletravail: 'ONSITE' },
  { id: `${P}tele-inconnu`, maison: M.tele, age: 4 },
  { id: `${P}tele-hybride`, maison: M.tele, age: 4, teletravail: 'HYBRID' },
  // Le lieu : à 2 km de Paris (3 jours), à Meaux (41 km, 1 jour).
  { id: `${P}lieu-paris`, maison: M.lieu, age: 3, titre: 'Conseiller de vente', point: [PARIS.lat + 0.018, PARIS.lon] },
  { id: `${P}lieu-meaux`, maison: M.lieu, age: 1, titre: 'Conseiller de vente', ville: 'Meaux' },
  // Le métier choisi : principal (8 jours), lu seulement dans l'intitulé (2 jours).
  { id: `${P}met-principal`, maison: M.met, age: 8, titre: 'Sales Advisor', metier: 'classer' },
  { id: `${P}met-lu`, maison: M.met, age: 2, titre: 'Responsable', roles: ['metier-du-temoin'] },
  // Un filtre de contrat sous une requête : les reconnues d'abord (D-513, R-143 §6), même anciennes.
  { id: `${P}filtre-cdi-ancien`, maison: M.filtre, age: 40, titre: 'Conseiller de vente', contrat: 'PERMANENT' },
  { id: `${P}filtre-inconnu-frais`, maison: M.filtre, age: 1, titre: 'Conseiller de vente' },
  // Le salaire, dans la devise et la période des préférences (2 000 € par mois) : au-dessus, en dessous, « à partir de »
  // en dessous, une autre période.
  { id: `${P}sal-dessus`, maison: M.sal, age: 3, salaire: { min: 1800, max: 2400, devise: 'EUR', periode: 'MONTH' } },
  { id: `${P}sal-dessous`, maison: M.sal, age: 3, salaire: { min: 1500, max: 1800, devise: 'EUR', periode: 'MONTH' } },
  { id: `${P}sal-a-partir`, maison: M.sal, age: 3, salaire: { min: 1500, max: null, devise: 'EUR', periode: 'MONTH' } },
  { id: `${P}sal-annuel`, maison: M.sal, age: 3, salaire: { min: 30000, max: 40000, devise: 'EUR', periode: 'YEAR' } },
  ...PAGE,
];

const directe = (suffixe: string, maison: string, age: number) => ({
  id: `${P}directe-${suffixe}`, version: BigInt(1), appliedSeq: BigInt(1), eligible: true, payloadHash: 'temoin', payload: {},
  correspondanceVersion: 1, slug: `${P}directe-${suffixe}`, title: 'Assistant administratif', company: maison, companyId: maison,
  countryCode: 'FR', city: 'Lyon', location: 'Lyon', language: 'fr', description: 'Conseiller zibeline recherché.',
  applyUrl: `https://catwalks.io/offres/${P}directe-${suffixe}`, postedAt: il(age), receivedAt: il(age),
  modifiedAt: il(age), searchText: 'Assistant administratif' });

/** Le score attendu d'une offre, recalculé ici (la formule de `classement.ts`, à l'instant du témoin). */
const score = (points: number, age: number) => (BASE + points) * 0.5 ** (age / DEMI_VIE_JOURS);

describe.skipIf(!enabled)('R-143 §7 : le classement pertinent, sur une base locale dédiée', () => {
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
    const catalogue = await loadOccupationTaxonomy(prisma), decision = catalogue.classify('Sales Advisor');
    const classee = { ...persistedOccupationDecision(decision), titleRoles: occupationTitleRoles(catalogue, 'Sales Advisor', decision), titleRolesReleaseId: catalogue.manifest.id };
    METIER = classee.occupationCode!;
    const classer = (titre: string) => { const d = catalogue.classify(titre);
      return { ...persistedOccupationDecision(d), titleRoles: occupationTitleRoles(catalogue, titre, d), titleRolesReleaseId: catalogue.manifest.id }; };
    for (const m of Object.values(M)) {
      await prisma.company.create({ data: { id: m, name: m, canonicalKey: m, fashionjobsUrl: `resolved:${m}`, sector: 'LUXURY', parentGroup: 'Groupe R143' } });
    }
    for (const o of OFFRES) {
      const lien = `https://example.com/${o.id}`, titre = o.titre ?? 'Conseiller de vente', ville = o.ville ?? 'Paris';
      await prisma.job.create({ data: { id: o.id, companyId: o.maison, externalId: o.id, source: 'GENERIC_JSONLD', title: titre, url: lien,
        isActive: true, countryCode: 'FR', city: ville, location: ville, description: o.description ?? null,
        latitude: o.point?.[0] ?? null, longitude: o.point?.[1] ?? null, postedAt: il(o.age), firstSeenAt: il(o.age),
        employmentTerm: o.contrat ?? null, programType: o.programme ?? null, workplaceType: o.teletravail ?? null,
        ...(o.metier === 'classer-titre' ? classer(o.titre!) : o.metier ? classee : o.roles ? { titleRoles: o.roles.map((r) => (r === 'metier-du-temoin' ? METIER : r)), titleRolesReleaseId: classee.titleRolesReleaseId } : {}),
        salaryMin: o.salaire?.min ?? null, salaryMax: o.salaire?.max ?? null, salaryCurrency: o.salaire?.devise ?? null, salaryPeriod: o.salaire?.periode ?? null } });
      await prisma.jobSource.create({ data: { jobId: o.id, sourceKey: 'r143c', sourceTier: 'ATS_OFFICIAL', externalId: o.id, url: lien, isActive: true,
        ...publicationFixture({ sourceKey: 'r143c', sourceTier: 'ATS_OFFICIAL', externalId: o.id, url: lien, title: titre, country: 'FR' }) } });
    }
    await prisma.directOffer.create({ data: directe('ancienne', M.mot, 120) });
    while (await drainSearchIndex()) { /* index à jour */ }
  }, 120_000);
  afterAll(nettoyer);
  afterEach(() => { vi.useRealTimers(); });

  /** Le contrat 2, tel que la route le pose (`x-catwalks-client: 2`). */
  const v2 = (maison: string, extra: Partial<JobFilters> = {}): JobFilters =>
    ({ marche: 'FR', proximite: true, comprendre: true, fraicheur: true, nonPrecisees: true, ...extra, filtres: { maison: [maison], ...extra.filtres } });
  /** Le contrat 1 : sans l'en-tête. */
  const v1 = (maison: string, extra: Partial<JobFilters> = {}): JobFilters => ({ marche: 'FR', ...extra, filtres: { maison: [maison], ...extra.filtres } });
  const ids = async (f: JobFilters) => (await getJobs(f)).jobs.map((j) => j.id);
  /** L'ordre de D-510 sur les mêmes offres : la plus fraîche d'abord. */
  const parFraicheur = (liste: string[]) => [...liste].sort((a, b) => OFFRES.find((o) => o.id === a)!.age - OFFRES.find((o) => o.id === b)!.age || (a < b ? -1 : 1));
  const critere = (j: JobRow, nom: string) => j.classement?.criteres.find((c) => c.critere === nom);

  it('sans requête ni préférences : l’ordre de D-510, inchangé, sans classement', async () => {
    const r = await getJobs(v2(M.ctr));
    expect(r.jobs.map((j) => j.id)).toEqual(parFraicheur(OFFRES.filter((o) => o.maison === M.ctr).map((o) => o.id)));
    expect(r.jobs.every((j) => j.classement === undefined)).toBe(true);
  });

  it('une requête tapée : l’intitulé qui la nomme passe devant une offre plus fraîche trouvée par sa description, mais pas un intitulé de trois mois', async () => {
    const attendu = [`cw_${P}directe-ancienne`, `${P}mot-titre`, `${P}mot-description`, `${P}mot-ancienne`];
    // PRÉMISSE : dans l'ordre de D-510, la description fraîche passerait devant l'intitulé de 10 jours.
    expect(parFraicheur([`${P}mot-titre`, `${P}mot-description`])[0]).toBe(`${P}mot-description`);
    expect(score(POINTS.intitule.requete, 10)).toBeGreaterThan(score(0, 1));
    expect(score(POINTS.intitule.requete, 90)).toBeLessThan(score(0, 1));
    const r = await getJobs(v2(M.mot, { q: 'zibeline' }));
    // D-419 : l'offre Catwalks reste en tête, à 120 jours et trouvée par sa seule description.
    expect(r.jobs.map((j) => j.id)).toEqual(attendu);
    const titre = r.jobs.find((j) => j.id === `${P}mot-titre`)!;
    expect(critere(titre, 'intitule')).toEqual({ critere: 'intitule', etat: 'nomme_la_recherche', points: POINTS.intitule.requete });
    expect(critere(r.jobs.find((j) => j.id === `${P}mot-description`)!, 'intitule')?.etat).toBe('trouvee_ailleurs');
    expect(titre.classement!.ageJours).toBeCloseTo(10, 0);
  });

  it('l’écriture inclusive : « Conseiller·ère de vente » nomme la recherche « conseiller de vente »', async () => {
    const r = await getJobs(v2(M.incl, { q: 'conseiller de vente' }));
    // PRÉMISSE : les deux sont retenues (par leur métier) ; la suite exacte « conseiller de vente » n'est pas dans leur
    // intitulé (« conseiller e de vente » une fois indexé) ; la seconde n'a pas de métier principal.
    expect(r.jobs).toHaveLength(2);
    expect(r.jobs.map((j) => critere(j, 'intitule')?.etat)).toEqual(['nomme_la_recherche', 'nomme_la_recherche']);
  });

  it('une requête de métier : l’intitulé qui en porte une variante du marché vaut 40, le métier seulement lu dans l’intitulé 25', async () => {
    const r = await getJobs(v2(M.met, { q: 'conseiller de vente' }));
    const etat = (id: string) => critere(r.jobs.find((j) => j.id === `${P}${id}`)!, 'intitule')?.etat;
    // (Le métier principal tapé vaut aussi 40, `intituleSql` ; ici l'intitulé suffit, ce témoin ne l'isole pas.)
    expect(r.jobs.find((j) => j.id === `${P}met-principal`)?.title).toBe('Sales Advisor');
    expect(etat('met-principal')).toBe('nomme_la_recherche');
    expect(etat('met-lu')).toBe('porte_le_metier');
  });

  it('les préférences de contrat : l’accord passe devant l’inconnu, l’inconnu devant le désaccord, et l’inconnu frais devant l’accord ancien', async () => {
    const r = await getJobs(v2(M.ctr, { preferences: { contrats: ['PERMANENT', 'APPRENTICESHIP'] } }));
    const ordre = r.jobs.map((j) => j.id);
    const avant = (a: string, b: string) => expect(ordre.indexOf(`${P}${a}`)).toBeLessThan(ordre.indexOf(`${P}${b}`));
    // PRÉMISSE : au même âge, D-510 les départage par l'identifiant (cdd < cdi < inconnu), l'inverse de l'ordre voulu.
    expect(parFraicheur([`${P}ctr-cdi`, `${P}ctr-inconnu`, `${P}ctr-cdd`])).toEqual([`${P}ctr-cdd`, `${P}ctr-cdi`, `${P}ctr-inconnu`]);
    avant('ctr-cdi', 'ctr-inconnu');
    avant('ctr-inconnu', 'ctr-cdd');
    avant('ctr-alternance', 'ctr-inconnu');
    // R-143 §10 : l'inconnu compte moins qu'un accord, sans plus — frais, il passe devant un CDI de 20 jours.
    expect(score(POINTS.contrat.neutre, 1)).toBeGreaterThan(score(POINTS.contrat.accord, 20));
    avant('ctr-inconnu-frais', 'ctr-cdi-ancien');
    const etats = Object.fromEntries(r.jobs.map((j) => [j.id.slice(P.length), critere(j, 'contrat')?.etat]));
    expect(etats).toMatchObject({ 'ctr-cdi': 'accord', 'ctr-inconnu': 'neutre', 'ctr-cdd': 'desaccord', 'ctr-alternance': 'accord' });
  });

  it('le télétravail suit les pastilles : ouvert, l’hybride s’accorde et le site reste neutre ; sur site, le télétravail complet est un désaccord', async () => {
    const ouvert = await getJobs(v2(M.tele, { preferences: { teletravail: true } }));
    const etat = (r: Awaited<ReturnType<typeof getJobs>>) => Object.fromEntries(r.jobs.map((j) => [j.id.slice(P.length), critere(j, 'teletravail')?.etat]));
    expect(etat(ouvert)).toEqual({ 'tele-distance': 'accord', 'tele-hybride': 'accord', 'tele-site': 'neutre', 'tele-inconnu': 'neutre' });
    expect(ouvert.jobs.slice(0, 2).map((j) => j.id).sort()).toEqual([`${P}tele-distance`, `${P}tele-hybride`]);
    const site = await getJobs(v2(M.tele, { preferences: { teletravail: false } }));
    expect(etat(site)).toEqual({ 'tele-distance': 'desaccord', 'tele-hybride': 'neutre', 'tele-site': 'accord', 'tele-inconnu': 'neutre' });
    expect(site.jobs[0].id).toBe(`${P}tele-site`);
    expect(site.jobs.at(-1)!.id).toBe(`${P}tele-distance`);
  });

  it('le salaire suit les pastilles : même devise et même période, le haut de la fourchette contre le minimum', async () => {
    const r = await getJobs(v2(M.sal, { preferences: { salaire: { montant: 2000, devise: 'EUR', periode: 'MONTH' } } }));
    const etats = Object.fromEntries(r.jobs.map((j) => [j.id.slice(P.length), critere(j, 'salaire')?.etat]));
    expect(etats).toEqual({ 'sal-dessus': 'accord', 'sal-dessous': 'desaccord', 'sal-a-partir': 'neutre', 'sal-annuel': 'neutre' });
    expect(r.jobs[0].id).toBe(`${P}sal-dessus`);
    expect(r.jobs.at(-1)!.id).toBe(`${P}sal-dessous`);
  });

  it('une requête et un lieu : l’offre à 2 km passe devant l’offre de Meaux plus fraîche, la distance devient un signal', async () => {
    // PRÉMISSE : D-510 range Meaux d'abord (plus fraîche), et le lieu seul (sans requête) le garde (test de D-510).
    expect(await ids(v2(M.lieu, { lieu: 'Paris (75)' }))).toEqual([`${P}lieu-meaux`, `${P}lieu-paris`]);
    const r = await getJobs(v2(M.lieu, { lieu: 'Paris (75)', q: 'conseiller de vente' }));
    expect(r.jobs.map((j) => j.id)).toEqual([`${P}lieu-paris`, `${P}lieu-meaux`]);
    expect(critere(r.jobs[0], 'lieu')?.etat).toBe('dans_le_lieu');
    expect(critere(r.jobs[1], 'lieu')?.etat).toBe('a_50_km');
  });

  it('le métier choisi (filtre `metier`) : le métier principal passe devant le métier lu dans l’intitulé, plus frais', async () => {
    expect(parFraicheur([`${P}met-principal`, `${P}met-lu`])[0]).toBe(`${P}met-lu`);
    const r = await getJobs(v2(M.met, { filtres: { maison: [M.met], metier: [METIER] } }));
    expect(r.jobs.map((j) => j.id)).toEqual([`${P}met-principal`, `${P}met-lu`]);
    expect(r.jobs.map((j) => critere(j, 'intitule')?.etat)).toEqual(['nomme_la_recherche', 'porte_le_metier']);
  });

  it('un filtre de contrat sous une requête : les offres reconnues d’abord (R-143 §6), même anciennes', async () => {
    const r = await getJobs(v2(M.filtre, { q: 'conseiller de vente', filtres: { maison: [M.filtre], contrat: ['PERMANENT'] } }));
    expect(r.jobs.map((j) => j.id)).toEqual([`${P}filtre-cdi-ancien`, `${P}filtre-inconnu-frais`]);
    expect(r.jobs[1].correspondance).toEqual({ statut: 'NON_CONFIRMEE', dimensions: ['contrat'] });
  });

  it('la pagination est stable, même quand le temps passe entre deux pages : ni doublon ni trou', async () => {
    const f = v2(M.page, { preferences: { contrats: ['PERMANENT'] } });
    const pts = (o: Offre) => (o.contrat === 'PERMANENT' ? POINTS.contrat.accord : o.contrat ? 0 : POINTS.contrat.neutre);
    const attendu = [...PAGE].sort((a, b) => Math.round(score(pts(b), b.age) * 1000) - Math.round(score(pts(a), a.age) * 1000)
      || a.age - b.age || (a.id < b.id ? -1 : 1)).map((o) => o.id);
    // PRÉMISSE : des égalités de score couvrent la frontière de la 1re page ; l'ordre de D-510 est un autre ordre.
    const egales = PAGE.filter((o) => o.age === 5 && !o.contrat).map((o) => attendu.indexOf(o.id));
    expect(Math.min(...egales)).toBeLessThan(25);
    expect(Math.max(...egales)).toBeGreaterThanOrEqual(25);
    expect(parFraicheur(PAGE.map((o) => o.id))).not.toEqual(attendu);
    const page1 = await getJobs(f);
    // Trois jours passent avant la page suivante : l'âge de chaque offre change, l'ordre de la lecture ne bouge pas.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 3 * JOUR));
    const vus = page1.jobs.map((j) => j.id);
    let apres = page1.suivant ?? undefined;
    let pages = 1;
    while (apres && pages < 10) {
      const r = await getJobs({ ...f, apres });
      vus.push(...r.jobs.map((j) => j.id));
      apres = r.suivant ?? undefined;
      pages++;
    }
    expect(pages).toBe(3);
    expect(new Set(vus).size).toBe(vus.length);
    expect(vus).toEqual(attendu);
  });

  it('les deux ordres ne se mélangent jamais : un curseur d’un ordre est refusé par l’autre', async () => {
    const fraicheur = await getJobs(v2(M.page));
    const pertinent = await getJobs(v2(M.page, { preferences: { contrats: ['PERMANENT'] } }));
    const contrat1 = await getJobs(v1(M.page));
    expect(fraicheur.suivant && pertinent.suivant && contrat1.suivant).toBeTruthy();
    await expect(getJobs({ ...v2(M.page, { preferences: { contrats: ['PERMANENT'] } }), apres: fraicheur.suivant! })).rejects.toBeInstanceOf(CurseurInvalideError);
    await expect(getJobs({ ...v2(M.page), apres: pertinent.suivant! })).rejects.toBeInstanceOf(CurseurInvalideError);
    await expect(getJobs({ ...v1(M.page), apres: pertinent.suivant! })).rejects.toBeInstanceOf(CurseurInvalideError);
    await expect(getJobs({ ...v2(M.page, { preferences: { contrats: ['FIXED_TERM'] } }), apres: pertinent.suivant! })).rejects.toBeInstanceOf(CurseurInvalideError);
    // Le jeton est chiffré et authentifié (lecture D-492 du 02/10/2026, curseur signé) : un instant de référence modifié
    // ne se forge plus ; un octet changé est refusé. Le garde de l'instant reste : un curseur servi il y a plus de 30 jours
    // n'est plus repris.
    const altere = Buffer.from(pertinent.suivant!, 'base64url');
    altere[altere.length - 1] ^= 0x01;
    await expect(getJobs({ ...v2(M.page, { preferences: { contrats: ['PERMANENT'] } }), apres: altere.toString('base64url') }))
      .rejects.toBeInstanceOf(CurseurInvalideError);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 31 * JOUR));
    await expect(getJobs({ ...v2(M.page, { preferences: { contrats: ['PERMANENT'] } }), apres: pertinent.suivant! })).rejects.toMatchObject({ detail: 'instant' });
  });

  it('le contrat 1 ignore les préférences et ne change pas : même ordre, même curseur, sans classement', async () => {
    const sans = await getJobs(v1(M.ctr));
    const avec = await getJobs(v1(M.ctr, { preferences: { contrats: ['PERMANENT'], teletravail: true } }));
    expect(avec.jobs.map((j) => j.id)).toEqual(sans.jobs.map((j) => j.id));
    expect(avec.jobs.every((j) => j.classement === undefined)).toBe(true);
    const q = await getJobs(v1(M.mot, { q: 'zibeline' }));
    expect(q.jobs.every((j) => j.classement === undefined)).toBe(true);
  });

  it('l’en-tête des préférences se lit (`pref_*`) et écarte ce qui n’est pas une préférence ; l’URL n’en porte plus aucune', () => {
    const entete = 'pref_contrat=PERMANENT&pref_contrat=NIMPORTE&pref_teletravail=oui&pref_lieu=Paris+%2875%29&pref_metier=temoin&pref_salaire=2000%3Aeur%3AMONTH&q=ignore';
    expect(preferencesDepuisEntete(entete)).toEqual({ metiers: ['temoin'], lieux: ['Paris (75)'], contrats: ['PERMANENT', 'NIMPORTE'], teletravail: true,
      salaire: { montant: 2000, devise: 'EUR', periode: 'MONTH' } });
    expect(preferencesDepuisEntete('pref_teletravail=peut-etre&pref_salaire=2000')).toBeUndefined();
    expect(preferencesDepuisEntete(null)).toBeUndefined();
    expect(preferencesDepuisEntete(`pref_lieu=${'a'.repeat(ENTETE_PREFERENCES_MAX)}`)).toBeUndefined();
    // Défaut gardé (suites du classement, 02/10/2026) : le salaire voyageait dans l'adresse, que les journaux d'hébergement
    // conservent. Une adresse qui en porte encore n'en tire rien.
    expect(parseFilters({ marche: 'FR', pref_contrat: 'PERMANENT', pref_salaire: '2000:EUR:MONTH' }).preferences).toBeUndefined();
  });

  it('la route : les préférences de l’en-tête classent, celles de l’adresse ne classent rien, et aucun journal ne les écrit', async () => {
    vi.stubEnv('CATALOGUE_API_KEY', 'cle-du-site');
    const journaux: string[] = [];
    const espions = (['info', 'log', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { journaux.push(a.map(String).join(' ')); }));
    try {
      const { GET } = await import('../../app/api/jobs/route');
      const appel = (chemin: string, entetes: Record<string, string> = {}) => new NextRequest(`http://catalogue.test${chemin}`,
        { headers: { authorization: 'Bearer cle-du-site', 'x-catwalks-client': '2', ...entetes } });
      const chemin = `/api/jobs?marche=FR&maison=${encodeURIComponent(M.sal)}`;
      const salaire = 'pref_salaire=2000%3AEUR%3AMONTH';
      const sans = await (await GET(appel(chemin))).json();
      // PRÉMISSE : sans préférence, l'offre au-dessus du minimum n'ouvre pas la liste (ordre de D-510).
      expect(sans.jobs[0].id).not.toBe(`${P}sal-dessus`);
      const parEntete = await GET(appel(chemin, { [ENTETE_PREFERENCES]: salaire }));
      const corps = await parEntete.json();
      expect(corps.jobs[0].id).toBe(`${P}sal-dessus`);
      expect(corps.jobs.at(-1).id).toBe(`${P}sal-dessous`);
      expect(parEntete.headers.get('cache-control')).toBe('private, no-store');
      const parAdresse = await (await GET(appel(`${chemin}&${salaire}`))).json();
      expect(parAdresse.jobs.map((j: { id: string }) => j.id)).toEqual(sans.jobs.map((j: { id: string }) => j.id));
      // Les journaux de la route : des comptes, jamais une préférence.
      expect(journaux.length).toBeGreaterThan(0);
      expect(journaux.join('\n')).not.toMatch(/pref_|2000|EUR|MONTH/);
    } finally {
      espions.forEach((e) => e.mockRestore());
      vi.unstubAllEnvs();
    }
  });

  it('les préférences de lieu, sans lieu cherché : la ville préférée passe devant (« Paris (75) » vaut Paris)', async () => {
    const r = await getJobs(v2(M.lieu, { q: 'conseiller de vente', preferences: { lieux: ['Meaux (77)'] } }));
    expect(r.jobs.map((j) => j.id)).toEqual([`${P}lieu-meaux`, `${P}lieu-paris`]);
    expect(r.jobs.map((j) => critere(j, 'lieu')?.etat)).toEqual(['dans_le_lieu', 'plus_loin']);
  });

  it('l’examen d’une alerte qui porte une requête rend ses nouvelles dans l’ordre pertinent de la page', async () => {
    const page = await getJobs(v2(M.mot, { q: 'zibeline' }));
    const examen = await examinerAlerte(v2(M.mot, { q: 'zibeline' }), il(365), il(365));
    expect(examen.jobs.map((j) => j.id)).toEqual(page.jobs.map((j) => j.id));
  });

  it('le classement servi se relit : ses points et son score', () => {
    const c = lireClassement([40, null, POINTS.contrat.neutre, 5, null, 14]);
    expect(c.criteres.map((x) => `${x.critere}:${x.etat}`)).toEqual(['intitule:nomme_la_recherche', 'contrat:neutre', 'teletravail:neutre']);
    expect(c.points).toBe(BASE + 40 + POINTS.contrat.neutre + 5);
    expect(c.score).toBeCloseTo((BASE + 45 + POINTS.contrat.neutre) / 2, 3);
  });
});
