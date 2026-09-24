import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { getJobs, type JobFilters } from '../jobs';
import { initializeSearchIndex, drainSearchIndex } from '../search-index';
import { CurseurInvalideError, decoderCurseur, empreinteCriteres, encoderCurseur } from '../curseur';
import { suggestCities, suggestTitles } from '../suggestions';
import { resoudrePerimetre } from '../perimetre';

/**
 * LE TÉMOIN DU LOT 7 — pertinence multilingue et curseur, sur une vraie base.
 *
 * Chaque cas part d'une PRÉMISSE mesurée (le texte porte bien l'accent, la
 * casse, l'apostrophe typographique, le joker) : un témoin qui ne prouve pas
 * que sa situation de départ remplit la condition du défaut ne teste rien.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);

const M = 'temoin-pertinence';
const MAISON = 'Maison Pertinence Témoin';
const BERLUTI = 'Berluti';
const companyId = (nom: string) => `${M}-${nom === MAISON ? 'maison' : 'berluti'}`;

type G = { id: string; maison?: string; pays?: string; ville?: string; titre: string; description?: string; contrat?: string | null; temps?: string | null; langue?: string; posteLe?: string };
const GRAINES: readonly G[] = [
  { id: 'ecole-titre', titre: 'École de vente — Responsable', description: 'Vous animez la formation des équipes.', contrat: 'PERMANENT', posteLe: '2026-09-01' },
  { id: 'ecole-desc', titre: 'Responsable boutique', description: "Formation assurée à l'école interne de la Maison.", contrat: 'FIXED_TERM', posteLe: '2026-09-02' },
  { id: 'responsable-desc', titre: 'Conseiller de vente', description: 'Vous rendez compte au responsable du magasin.', contrat: 'PERMANENT', posteLe: '2026-09-03' },
  { id: 'berluti', maison: BERLUTI, titre: 'Conseiller de vente', description: 'Souliers et maroquinerie.', contrat: 'PERMANENT', posteLe: '2026-09-04' },
  { id: 'apostrophe', titre: "L’Oréal Beauty Advisor", description: 'Conseil beauté en parfumerie.', contrat: 'PERMANENT', posteLe: '2026-09-05' },
  { id: 'chine', pays: 'CN', ville: 'Shanghai', titre: '销售顾问', description: '负责门店销售与客户服务。', langue: 'zh', contrat: 'PERMANENT', posteLe: '2026-09-06' },
  { id: 'joker', titre: 'Vendeur 100% luxe', description: 'Objectif 100% satisfaction.', contrat: 'PERMANENT', posteLe: '2026-09-07' },
  { id: 'souligne', titre: 'Under_score Manager', description: 'Poste sous_ligné.', contrat: null, posteLe: '2026-09-08' },
  { id: 'huit', titre: 'Vendeur conseil luxe mode paris boutique retail ventes', description: 'huit termes puis deux de trop.', contrat: 'PERMANENT', temps: 'FULL_TIME', posteLe: '2026-09-09' },
];
const PAGINES = Array.from({ length: 30 }, (_, i) => ({ id: `page-${String(i).padStart(2, '0')}`, titre: `Assistant vente ${i}`, description: 'Pagination témoin.', contrat: 'PERMANENT', posteLe: `2026-08-${String(30 - i).padStart(2, '0')}` }));
const jobId = (g: G) => `${M}-${g.id}`;

const chercher = (marche: string, extra: Partial<JobFilters> = {}, maison: string = MAISON) =>
  getJobs({ marche, ...extra, filtres: { maison: [maison], ...(extra.filtres ?? {}) } });
const ids = (r: Awaited<ReturnType<typeof getJobs>>) => r.jobs.map((j) => j.id.replace(`${M}-`, ''));

describe.skipIf(!enabled)('pertinence multilingue et curseur (lot 7)', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { job: { id: { startsWith: M } } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: M } } });
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: M } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: M } } });
  };
  const semer = async (g: G) => {
    const maison = g.maison ?? MAISON;
    const lien = `https://example.com/${M}/${g.id}`;
    const pays = g.pays ?? 'FR';
    await prisma.job.create({ data: {
      id: jobId(g), companyId: companyId(maison), source: 'GENERIC_JSONLD', externalId: g.id, title: g.titre, description: g.description ?? null, url: lien, city: g.ville ?? 'Paris', countryCode: pays, employmentTerm: g.contrat ?? null, workTime: g.temps ?? 'FULL_TIME', language: g.langue ?? 'fr', isActive: true,
      postedAt: new Date(g.posteLe ?? '2026-08-01'), firstSeenAt: new Date(g.posteLe ?? '2026-08-01'),
      sources: { create: { sourceKey: M, sourceTier: 'ATS_OFFICIAL', externalId: g.id, url: lien, isActive: true,
        ...publicationFixture({ sourceKey: M, sourceTier: 'ATS_OFFICIAL', externalId: g.id, url: lien, title: g.titre, description: g.description, city: g.ville ?? 'Paris',
          country: pays, employmentTerm: g.contrat ?? undefined, workTime: g.temps ?? 'FULL_TIME', language: g.langue ?? 'fr', postedAt: new Date(g.posteLe ?? '2026-08-01') }) } },
    } });
  };
  beforeAll(async () => {
    await nettoyer();
    for (const nom of [MAISON, BERLUTI]) {
      await prisma.company.create({ data: { id: companyId(nom), name: nom, canonicalKey: companyId(nom), fashionjobsUrl: `resolved:${companyId(nom)}`, parentGroup: nom === BERLUTI ? 'LVMH' : null } });
    }
    for (const g of [...GRAINES, ...PAGINES]) await semer(g);
    await prisma.directOffer.create({ data: {
      id: `${M}-directe`, version: BigInt(1), appliedSeq: BigInt(1), eligible: true, payloadHash: 'temoin', payload: {}, correspondanceVersion: 1,
      slug: 'ecole-directe', title: 'École Témoin Directe', company: MAISON, countryCode: 'FR', city: 'Paris', location: 'Paris, FR', description: 'Offre directe.',
      applyUrl: 'https://catwalks.io/offres/ecole-directe', postedAt: new Date('2026-09-10'), modifiedAt: new Date('2026-09-10'), searchText: 'École Témoin Directe\nMaison Pertinence Témoin\nParis',
    } });
    await initializeSearchIndex();
    while (await drainSearchIndex()) {}
  }, 120_000);
  afterAll(nettoyer);

  it('PRÉMISSE — le texte indexé est normalisé dans la base : sans accent, en minuscules, apostrophes unifiées', async () => {
    const [ecole, apostrophe, directe] = await Promise.all([
      prisma.job.findUniqueOrThrow({ where: { id: `${M}-ecole-titre` }, select: { searchText: true, title: true } }),
      prisma.job.findUniqueOrThrow({ where: { id: `${M}-apostrophe` }, select: { searchText: true, title: true } }),
      prisma.directOffer.findUniqueOrThrow({ where: { id: `${M}-directe` }, select: { searchText: true } }),
    ]);
    expect(ecole.title).toContain('École');
    expect(ecole.searchText.startsWith('ecole de vente')).toBe(true);
    expect(apostrophe.title).toContain('’');
    expect(apostrophe.searchText.startsWith("l'oreal beauty advisor")).toBe(true);
    expect(directe.searchText.startsWith('ecole temoin directe')).toBe(true);
  });

  it('PRÉMISSE — les vecteurs de mots sont maintenus par la base : titre en A, Maison en B, tout le texte sans positions', async () => {
    const [ecole] = await prisma.$queryRaw<Array<{ titre: string; texte: string }>>`
      SELECT "titleVector"::text AS titre, "searchVector"::text AS texte FROM "Job" WHERE id = ${`${M}-ecole-titre`}`;
    expect(ecole.titre).toContain("'ecole':1A");
    expect(ecole.titre).toContain("'maison':");
    expect(ecole.titre).toMatch(/'temoin':\d+B/);
    expect(ecole.texte).toContain("'formation'");
    expect(ecole.texte).not.toMatch(/'formation':\d/);
    // Les identités (Maison résolue, code métier) sont des mots du vecteur qui filtre (migration 20260916210200).
    expect(ecole.texte).toContain("'maisontemoinpertinencemaison'");
    expect(ecole.texte).not.toContain("'metier");
    const [directe] = await prisma.$queryRaw<Array<{ titre: string }>>`SELECT "titleVector"::text AS titre FROM "DirectOffer" WHERE id = ${`${M}-directe`}`;
    expect(directe.titre).toContain("'ecole':1A");
    expect(directe.titre).toMatch(/'pertinence':\d+B/);
  });

  it('PRÉMISSE — les sessions du client planifient chaque recherche avec ses valeurs, jamais un plan générique (migration 20260916210300)', async () => {
    // Reproduit sur le clone : le plan générique parcourt l'index du pays et évalue le vecteur ligne à ligne
    // (24 → 298 ms sur « école », 610 → 4 796 ms sur « store manager »). Le rôle de l'API force le plan personnalisé.
    const [{ plan_cache_mode }] = await prisma.$queryRaw<Array<{ plan_cache_mode: string }>>`SHOW plan_cache_mode`;
    expect(plan_cache_mode).toBe('force_custom_plan');
  });

  it('un terme s’apparie au DÉBUT d’un mot : « ventes » et « vente » trouvent, « ente » ne trouve rien', async () => {
    // Prémisse : « ente » est bien une sous-chaîne du texte indexé (« vente », « ventes ») — une recherche
    // par sous-chaîne le trouverait ; la recherche par mot ne le fait pas.
    const huit = await prisma.job.findUniqueOrThrow({ where: { id: `${M}-huit` }, select: { searchText: true } });
    expect(huit.searchText).toContain('ente');
    expect(ids(await chercher('FR', { q: 'ventes' }))).toEqual(['huit']);
    expect(ids(await chercher('FR', { q: 'ente' }))).toEqual([]);
  });

  it('« école », « ecole », « ÉCOLE » : la même recherche, les mêmes offres — et le titre avant la description', async () => {
    const attendus = ['cw_directe', 'ecole-titre', 'ecole-desc'];
    for (const q of ['école', 'ecole', 'ÉCOLE', 'Ecole']) {
      const r = await chercher('FR', { q });
      expect(ids(r).sort(), q).toEqual([...attendus].sort());
    }
    const r = await chercher('FR', { q: 'ecole' });
    // Catwalks d'abord (D-419), puis le titre (score 2) avant la description (score 0).
    expect(r.jobs.map((j) => j.id)).toEqual([`cw_${M}-directe`, `${M}-ecole-titre`, `${M}-ecole-desc`]);
  });

  it('le score classe le titre avant la description, à origine égale, avant la fraîcheur', async () => {
    const r = await chercher('FR', { q: 'responsable' });
    // Prémisse : la plus fraîche (03/09) ne porte « responsable » qu'en description.
    expect(ids(r)).toEqual(['ecole-desc', 'ecole-titre', 'responsable-desc']);
  });

  it('une marque ou un groupe du référentiel trouve les offres de ses Maisons, sans 52 clauses de texte', async () => {
    // Prémisse : Berluti est une Maison du groupe LVMH dans le référentiel, et son offre ne contient pas « lvmh ».
    const berluti = await prisma.job.findUniqueOrThrow({ where: { id: `${M}-berluti` }, select: { title: true, description: true } });
    expect(berluti.title + berluti.description).not.toMatch(/lvmh/i);
    expect(ids(await chercher('FR', { q: 'LVMH' }, BERLUTI))).toEqual(['berluti']);
    expect(ids(await chercher('FR', { q: 'berluti' }, BERLUTI))).toEqual(['berluti']);
    expect(ids(await chercher('FR', { q: 'lvmh' }, MAISON))).toEqual([]);
  });

  it('l’apostrophe typographique et l’apostrophe droite sont la même recherche', async () => {
    expect(ids(await chercher('FR', { q: "l'oréal" }))).toEqual(['apostrophe']);
    expect(ids(await chercher('FR', { q: 'l’oreal' }))).toEqual(['apostrophe']);
    expect(ids(await chercher('FR', { q: 'oréal beauty' }))).toEqual(['apostrophe']);
  });

  it('une requête chinoise sans espace trouve l’offre chinoise sur le marché chinois', async () => {
    expect(ids(await chercher('CN', { q: '销售' }))).toEqual(['chine']);
    expect(ids(await chercher('CN', { q: '客户服务' }))).toEqual(['chine']);
    expect(ids(await chercher('FR', { q: '销售' }))).toEqual([]);
  });

  it('un joker est littéral : « % » et « _ » ne sont jamais des jokers, ni dans les mots ni dans le texte', async () => {
    // Un terme sans lettre ni chiffre s'apparie littéralement dans le texte normalisé : seul « joker » porte un « % ».
    expect(ids(await chercher('FR', { q: '%' }))).toEqual([]);
    // Dans un terme lexical, « % » et « _ » séparent les mots : « 100% » est le mot « 100 », « under_score » les mots
    // « under » et « score », « sous%ligne » les mots « sous » et « ligne » — jamais un « n'importe quoi ».
    expect(ids(await chercher('FR', { q: '100%' }))).toEqual(['joker']);
    expect(ids(await chercher('FR', { q: 'under_score' }))).toEqual(['souligne']);
    expect(ids(await chercher('FR', { q: 'sous_ligne' }))).toEqual(['souligne']);
    expect(ids(await chercher('FR', { q: 'sous%ligne' }))).toEqual(['souligne']);
    // Prémisse du joker : « s_us » trouverait « sous » si « _ » était un joker d'un caractère.
    expect(ids(await chercher('FR', { q: 's_us' }))).toEqual([]);
  });

  it('retains trailing constraints beyond eight words', async () => {
    const r = await chercher('FR', { q: 'vendeur conseil luxe mode paris boutique retail ventes introuvable inexistant' });
    expect(ids(r)).toEqual([]);
  });

  it('ET entre dimensions, OU entre valeurs, inconnues conservées (D-435), avec la recherche texte', async () => {
    const r = await chercher('FR', { q: 'manager', filtres: { contrat: ['PERMANENT', 'FIXED_TERM'] } });
    expect(ids(r)).toEqual(['souligne']);
    expect(r.jobs[0].correspondance).toEqual({ statut: 'NON_CONFIRMEE', dimensions: ['contrat'] });
  });

  it('CURSEUR — deux pages sans doublon ni saut ; une insertion concurrente n’apparaît qu’à la prochaine recherche ; un retrait ne fait rien sauter', async () => {
    const filtres = { maison: [MAISON], contrat: ['PERMANENT'] };
    const page1 = await getJobs({ marche: 'FR', q: 'assistant vente', filtres });
    expect(page1.jobs).toHaveLength(25);
    expect(page1.total).toBe(30);
    expect(page1.suivant).not.toBeNull();
    // Insertion concurrente : une offre PLUS FRAÎCHE que toutes les autres, entre les deux pages.
    await semer({ id: 'page-fraiche', titre: 'Assistant vente fraîche', description: 'Pagination témoin.', contrat: 'PERMANENT', posteLe: '2026-09-15' });
    // Retrait concurrent : la 27e offre de l'ordre disparaît avant la lecture de la page 2.
    const ordreAttendu = PAGINES.map((p) => p.id);
    await prisma.job.update({ where: { id: `${M}-${ordreAttendu[26]}` }, data: { isActive: false } });
    const page2 = await getJobs({ marche: 'FR', q: 'assistant vente', filtres, apres: page1.suivant! });
    const lus = [...ids(page1), ...ids(page2)];
    expect(new Set(lus).size).toBe(lus.length);
    expect(lus).not.toContain('page-fraiche');
    expect(lus).toEqual([...ordreAttendu.slice(0, 26), ...ordreAttendu.slice(27)]);
    expect(page2.suivant).toBeNull();
    while (await drainSearchIndex()) {}
    // Une nouvelle recherche voit l'insertion en tête.
    expect(ids(await getJobs({ marche: 'FR', q: 'assistant vente', filtres }))[0]).toBe('page-fraiche');
  });

  it('CURSEUR — un jeton d’autres critères, d’un autre périmètre ou malformé est refusé, sans requête', async () => {
    const page1 = await getJobs({ marche: 'FR', q: 'assistant vente', filtres: { maison: [MAISON] } });
    expect(page1.suivant).not.toBeNull();
    await expect(getJobs({ marche: 'FR', q: 'assistant', filtres: { maison: [MAISON] }, apres: page1.suivant! })).rejects.toBeInstanceOf(CurseurInvalideError);
    await expect(getJobs({ marche: 'US', q: 'assistant vente', filtres: { maison: [MAISON] }, apres: page1.suivant! })).rejects.toBeInstanceOf(CurseurInvalideError);
    await expect(getJobs({ marche: 'FR', q: 'assistant vente', filtres: { maison: [MAISON] }, apres: 'pas-un-jeton!' })).rejects.toBeInstanceOf(CurseurInvalideError);
    await expect(getJobs({ marche: 'FR', q: 'assistant vente', filtres: { maison: [MAISON] }, apres: encoderCurseur('deadbeefdeadbeef', [1, 0, 0, 0, 1, 1, 'x']) })).rejects.toMatchObject({ detail: 'autres critères' });
    // Le décodeur lui-même : version, arité, types.
    const h = empreinteCriteres({ a: 1 });
    expect(decoderCurseur(encoderCurseur(h, [1, 'x']), h, 2)).toEqual([1, 'x']);
    expect(() => decoderCurseur(encoderCurseur(h, [1, 'x']), h, 3)).toThrow(CurseurInvalideError);
    expect(() => decoderCurseur(Buffer.from(JSON.stringify({ v: 1, h, k: [1] })).toString('base64url'), h, 1)).toThrow(/version/);
    // L'empreinte ne dépend pas de l'ordre des clés.
    expect(empreinteCriteres({ a: 1, b: [2] })).toBe(empreinteCriteres({ b: [2], a: 1 }));
  });

  it('les suggestions ignorent les accents et la casse comme la recherche', async () => {
    const fr = resoudrePerimetre('FR')!;
    expect(await suggestTitles('ecole', fr)).toContain('École de vente');
    expect(await suggestTitles('ÉCOLE', fr)).toContain('École de vente');
    expect(await suggestCities('pari', fr)).toContain('Paris');
  });
});
