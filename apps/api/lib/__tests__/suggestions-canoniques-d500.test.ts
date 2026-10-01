import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma, prisma } from '@catwalks/db';
import * as database from '@catwalks/db/occupations';
import { occupationManifestHash } from '@catwalks/db/occupations';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { getJobs, type JobFilters } from '../jobs';
import { exigerPerimetre } from '../perimetre';
import { drainSearchIndex, initializeSearchIndex } from '../search-index';
import { correspond, suggestTitlesCanoniques, nettoyerIntitule } from '../suggestions-canoniques';
import { suggestLieuxDeTete } from '../suggestions';
import { CONSERVATION_MAX_JOURS, enregistrerRequete, formeGardee, JOURS_MIN_POPULAIRE, purgerRequetes, SEUIL_POPULAIRE, PURGE_JOURS } from '../requetes-tapees';
import { semerVilles, viderVilles } from '../__fixtures__/villes';

/**
 * D-500 (Q1, Q2, Q4) et D-501 — de bout en bout sur une base locale : la requête comprise et le classement par
 * l'intitulé (contrat 2), les suggestions canoniques vérifiées par la recherche que lance leur choix, les lieux de tête
 * de la base de lieux, les requêtes tapées anonymes (seuil, purge, route).
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const P = 'd500-';
const MAISON = `${P}maison`, MAISON2 = `${P}maison-2`;
const GROUPE = 'Groupe Temoin D500';

type Offre = { titre: string; classeComme?: string; ville?: string; description?: string; n?: number; autreMaison?: boolean };
const OFFRES: readonly Offre[] = [
  { titre: 'Conseiller de vente H/F', classeComme: 'Conseiller de vente', n: 3 },
  { titre: 'CONSEILLER DE VENTE /NB', classeComme: 'Conseiller de vente', n: 2 },
  { titre: 'Conseillère de vente', classeComme: 'Conseiller de vente', n: 2 },
  { titre: 'Vendeuse', classeComme: 'Conseiller de vente' },
  // Une offre du métier dont l'intitulé ne nomme pas le métier : elle passe après celles qui le nomment (Q4).
  { titre: 'Talent de la maison', classeComme: 'Conseiller de vente' },
  { titre: 'Responsable boutique', classeComme: 'Responsable de boutique', n: 2 },
  // Trois offres « Responsable Boutique Adjoint » : un intitulé qui nomme l'adjoint dans un autre ordre (Q2).
  { titre: 'Responsable Boutique Adjoint', n: 2 },
  { titre: 'Responsable Boutique Adjoint', autreMaison: true },
  // Trois offres de la même expression, avec contrat, ville et marque : « Vendeur polyvalent » (Q2, intitulé nettoyé).
  { titre: 'Vendeur polyvalent CDD Toulouse', ville: 'Toulouse', n: 2 },
  { titre: 'Vendeur polyvalent (H/F)', ville: 'Toulouse', autreMaison: true },
  // Trois offres d'un intitulé qui se lirait comme un critère de sexe, chez deux Maisons : jamais suggéré (audit métier).
  { titre: 'Directeur de Magasin Femme H/F', n: 2 },
  { titre: 'Directeur de Magasin Femme H/F', autreMaison: true },
  // Sans métier, écrite en écriture inclusive : trouvée par la forme tapée, comme avant (Q1).
  { titre: 'Conseiller(ère) de vente' },
  // Trouvée par sa seule description : après toutes celles dont l'intitulé contient la requête (Q4).
  { titre: 'Styliste', description: 'Vous travaillerez avec chaque conseiller de la boutique.' },
  // Trois offres d'un intitulé d'une seule Maison : son intitulé maison, jamais une suggestion (audit métier).
  { titre: 'Vendeur expert huiles essentielles', n: 3 },
  // Une requête populaire n'est suggérée que si une offre l'écrit dans son intitulé (D-501).
  { titre: 'Conseillère de vente luxe', classeComme: 'Conseiller de vente' },
];

/** La taxonomie v3 ACTIVE, celle de la production : un autre témoin de la même base peut en avoir publié une autre. Rend
 * la version active d'avant, que `afterAll` remet : les témoins suivants retrouvent la base telle qu'ils l'attendent. */
async function activerV3(): Promise<string | null> {
  const avant = (await prisma.occupationState.findUnique({ where: { id: 'active' }, select: { releaseId: true } }))?.releaseId ?? null;
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'audits', '2026-09-28', 'curation-v3', '6-manifeste-v3.json'), 'utf8'));
  const existe = await prisma.occupationRelease.findUnique({ where: { id: manifest.id }, select: { id: true } });
  if (!existe) await prisma.occupationRelease.create({ data: { id: manifest.id, contentHash: occupationManifestHash(manifest), manifest } });
  if (avant !== manifest.id) await prisma.occupationState.upsert({ where: { id: 'active' }, create: { id: 'active', releaseId: manifest.id }, update: { releaseId: manifest.id } });
  return avant;
}

describe.skipIf(!enabled)('D-500, D-501 : la recherche comprend la requête', () => {
  const ids: string[] = [];
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: P } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.$executeRaw`DELETE FROM "RequeteTapee" WHERE "marche" IN ('FR', 'BE')`;
    await viderVilles(prisma);
    await initializeSearchIndex();
    while (await drainSearchIndex()) { /* index à jour */ }
  };

  let versionAvant: string | null = null;
  beforeAll(async () => {
    versionAvant = await activerV3();
    await nettoyer();
    await semerVilles(prisma);
    const catalogue = await database.loadOccupationTaxonomy(prisma);
    for (const m of [MAISON, MAISON2])
      await prisma.company.create({ data: { id: m, name: m, canonicalKey: m, fashionjobsUrl: `resolved:${m}`, sector: 'LUXURY', parentGroup: GROUPE } });
    let i = 0;
    for (const o of OFFRES) for (let k = 0; k < (o.n ?? 1); k++) {
      const id = `${P}${String(i++).padStart(2, '0')}`;
      ids.push(id);
      const lien = `https://example.com/${id}`;
      const decision = o.classeComme ? database.persistedOccupationDecision(catalogue.classify(o.classeComme)) : {};
      await prisma.job.create({ data: { id, companyId: o.autreMaison ? MAISON2 : MAISON, externalId: id, source: 'GENERIC_JSONLD', title: o.titre, url: lien, isActive: true,
        countryCode: 'FR', city: o.ville ?? 'Paris', location: o.ville ?? 'Paris', description: o.description ?? null, ...decision,
        postedAt: new Date(Date.UTC(2026, 8, 1 + (i % 28), 8)), firstSeenAt: new Date('2026-09-01T09:00:00Z'),
        lastSeenAt: new Date('2026-09-30T00:00:00Z') } });
      await prisma.jobSource.create({ data: { jobId: id, sourceKey: 'd500', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, isActive: true,
        ...publicationFixture({ sourceKey: 'd500', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, title: o.titre, country: 'FR' }) } });
    }
    while (await drainSearchIndex()) { /* index à jour */ }
  }, 120_000);
  afterAll(async () => {
    await nettoyer();
    const active = (await prisma.occupationState.findUnique({ where: { id: 'active' }, select: { releaseId: true } }))?.releaseId;
    if (versionAvant && active !== versionAvant) await prisma.occupationState.update({ where: { id: 'active' }, data: { releaseId: versionAvant } });
  });

  const fr = (f: Partial<JobFilters>): JobFilters => ({ marche: 'FR', ...f, filtres: { groupe: [GROUPE], ...f.filtres } });
  const titres = async (f: Partial<JobFilters>) => (await getJobs(fr(f))).jobs.map((j) => j.title);
  const metier = async (code: string) => (await getJobs(fr({ filtres: { metier: [code] } }))).total;

  it('PRÉMISSE : le métier porte 10 offres du témoin ; sans le contrat 2, l’écriture inclusive et « /NB » en perdent', async () => {
    expect(await metier('sales-advisor')).toBe(10);
    expect((await getJobs(fr({ q: 'conseiller(ère) de vente' }))).total).toBe(1);
    expect((await getJobs(fr({ q: 'CONSEILLER DE VENTE /NB' }))).total).toBe(2);
  });

  it('Q1 : au contrat 2, « conseiller(ère) de vente » et « …/NB » rendent toutes les offres du métier, et l’offre sans métier qui l’écrit', async () => {
    // La référence : la forme que la taxonomie connaît. Elle rend les 10 offres du métier, plus les 6 offres sans métier dont
    // l'intitulé écrit une expression du métier (« Vendeur polyvalent », « Vendeur expert… » ; D-475 §27 e).
    const reference = await getJobs(fr({ q: 'conseiller de vente', comprendre: true }));
    expect(reference.total).toBe(16);
    for (const q of ['conseiller(ère) de vente', 'CONSEILLER DE VENTE /NB', 'conseillère de vente H/F']) {
      const r = await getJobs(fr({ q, comprendre: true }));
      // Toutes celles de la référence ; « conseiller(ère) » trouve en plus l'offre sans métier qui l'écrit telle quelle.
      expect(r.total, q).toBe(q.startsWith('conseiller(') ? 17 : 16);
    }
    // « luxe » reste un mot de la requête : une recherche précise reste précise.
    expect((await getJobs(fr({ q: 'conseillère de vente luxe', comprendre: true }))).total).toBe(1);
    // « conseillère » seul trouve aussi « Conseiller … » ; avant, le seul mot exact.
    expect((await getJobs(fr({ q: 'conseillère' }))).total).toBe(3);
    expect((await getJobs(fr({ q: 'conseillère', comprendre: true }))).total).toBe(10);
  });

  it('Q4 : les intitulés qui contiennent la requête d’abord, puis le métier, puis la description', async () => {
    const t = await titres({ q: 'conseiller de vente', comprendre: true });
    expect(t.indexOf('Talent de la maison')).toBe(t.length - 1);
    const seul = await titres({ q: 'conseillère', comprendre: true });
    expect(seul.at(-1)).toBe('Styliste');
    expect(seul.slice(0, -1).every((x) => /conseill/i.test(x))).toBe(true);
    // Sans le contrat 2, l'ordre d'avant (le rang n'existe pas) : la requête mot à mot.
    expect((await getJobs(fr({ q: 'conseiller de vente' }))).jobs.map((j) => j.title)).not.toEqual(t);
  });

  it('Q4 : avec un lieu, la distance reste devant le rang (D-496) ; le rang départage à la même distance', async () => {
    const loin = ids[0];
    await prisma.job.update({ where: { id: loin }, data: { city: 'Créteil', location: 'Créteil' } });
    while (await drainSearchIndex()) { /* index à jour */ }
    try {
      const r = await getJobs(fr({ q: 'conseiller de vente', lieu: 'Paris', proximite: true, comprendre: true }));
      const ordre = r.jobs.map((j) => j.id);
      // PRÉMISSE : l'offre éloignée nomme le métier (rang le plus haut), l'offre de Paris ne le nomme pas (rang du métier).
      expect(r.jobs.find((j) => j.id === loin)?.title).toBe('Conseiller de vente H/F');
      const talent = r.jobs.find((j) => j.title === 'Talent de la maison')!.id;
      expect(ordre.indexOf(talent)).toBeLessThan(ordre.indexOf(loin));
      // À Paris, à la même distance, le rang : « Talent de la maison » après toutes celles de Paris qui nomment le métier.
      const aParis = ordre.filter((id) => id !== loin);
      expect(aParis.indexOf(talent)).toBe(aParis.length - 1);
    } finally {
      await prisma.job.update({ where: { id: loin }, data: { city: 'Paris', location: 'Paris' } });
      while (await drainSearchIndex()) { /* index à jour */ }
    }
  });

  it('Q2 : une ligne par métier dans la forme tapée, des intitulés nettoyés, jamais un intitulé brut', async () => {
    const fr = exigerPerimetre('FR');
    const conseill = await suggestTitlesCanoniques('conseill', fr, 'fr');
    expect(conseill[0]).toEqual({ valeur: 'Conseiller de vente', metier: { identifiant: 'sales-advisor', libelle: 'Conseiller de vente' }, nature: 'metier' });
    const conseillere = await suggestTitlesCanoniques('conseillère', fr, 'fr');
    expect(conseillere[0]).toMatchObject({ valeur: 'Conseillère de vente', metier: { identifiant: 'sales-advisor' }, nature: 'metier' });
    const vendeu = await suggestTitlesCanoniques('vendeu', fr, 'fr');
    expect(vendeu.filter((s) => s.metier?.identifiant === 'sales-advisor')).toHaveLength(1);
    expect(vendeu).toContainEqual({ valeur: 'Vendeur polyvalent', metier: null, nature: 'intitule' });
    expect(vendeu.map((x) => x.valeur)).not.toContain('Vendeur expert huiles essentielles');
    // Une variante qu'aucun intitulé du marché n'écrit n'est pas proposée (« Verkäufer » est une variante du métier, gardée
    // pour le marché français par son écriture, et aucune offre française ne l'écrit).
    expect((await suggestTitlesCanoniques('verkauf', fr, 'fr')).map((x) => x.valeur)).toEqual([]);
    const boutique = await suggestTitlesCanoniques('responsable bout', fr, 'fr');
    // PRÉMISSE : trois offres « Directeur de Magasin Femme H/F » chez deux Maisons ; jamais une suggestion.
    expect((await suggestTitlesCanoniques('directeur', fr, 'fr')).map((x) => x.valeur.toLowerCase()).join(' | ')).not.toContain('femme');
    expect(boutique[0]).toMatchObject({ metier: { identifiant: 'store-manager' }, nature: 'metier' });
    // Un intitulé dont les mots sont ceux d'une expression de métier, dans un autre ordre, rejoint la ligne de ce métier
    // (« Responsable boutique adjoint » est l'adjoint, que nomme « Responsable adjoint de boutique »).
    expect(boutique.map((x) => x.valeur)).not.toContain('Responsable boutique adjoint');
    for (const s of [...conseill, ...conseillere, ...vendeu, ...boutique]) {
      expect(s.valeur, s.valeur).not.toMatch(/\b(CDD|CDI|H\/F|NB)\b|\/|\(|Toulouse/i);
      expect(s.valeur === s.valeur.toUpperCase(), s.valeur).toBe(false);
      // La suggestion mène à des offres, par la recherche que lance son choix.
      const n = s.metier ? (await getJobs({ marche: 'FR', filtres: { metier: [s.metier.identifiant] } })).total
        : (await getJobs({ marche: 'FR', q: s.valeur, comprendre: true, filtres: {} })).total;
      expect(n, s.valeur).toBeGreaterThan(0);
    }
    // Aucun doublon pour un même métier, ni deux lignes de même texte.
    const cles = vendeu.map((s) => s.metier?.identifiant ?? s.valeur.toLowerCase());
    expect(new Set(cles).size).toBe(cles.length);
  });

  it('Q2 : la frappe répond au début d’un mot, liaisons omises, deux mots tapés soudés ; jamais un mot tapé découpé', () => {
    expect(correspond('conseiller de vente', 'conseill')).toBe(true);
    expect(correspond('responsable de boutique', 'responsable bout')).toBe(true);
    expect(correspond('makeup artist', 'make up')).toBe(true);
    expect(correspond('visual merchandiser', 'chand')).toBe(false);
    expect(correspond('conseiller en image', 'conseillere')).toBe(false);
  });

  it('Q2 : un intitulé nettoyé perd contrat, durée, marque, crochets, ville et niveau ; le titre natif reste intact', async () => {
    const villes = new Set(['toulouse', 'paris', 'saint tropez']);
    expect(nettoyerIntitule('Conseiller de Vente CDD Noël', villes)).toBe('Conseiller de vente noël');
    expect(nettoyerIntitule('[Fashion] Responsable Boutique Flagship', villes)).toBe('Responsable boutique flagship');
    expect(nettoyerIntitule('VISUAL MERCHANDISER MANAGER // CDI', villes)).toBe('Visual merchandiser manager');
    expect(nettoyerIntitule('Sales Advisor Saint Tropez', villes)).toBe('Sales advisor');
    expect(nettoyerIntitule('Conseillère de vente expérimentée Toulouse CDD', villes)).toBe('Conseillère de vente');
    expect(nettoyerIntitule('Store Manager (37.5 hours)', villes)).toBe('Store manager');
    expect(nettoyerIntitule('Directrice, Directeur de Magasin', villes)).toBe('Directeur de magasin');
    expect(nettoyerIntitule('CRM Manager', villes)).toBe('CRM manager');
    expect(nettoyerIntitule('CRM MANAGER', villes)).toBe('CRM manager');
    // Un sigle en fin d'intitulé reste (audit technique) ; les marques de contrat d'étudiant partent (audit métier).
    expect(nettoyerIntitule('Responsable RH', villes)).toBe('Responsable RH');
    expect(nettoyerIntitule('Directeur IT', villes)).toBe('Directeur IT');
    expect(nettoyerIntitule('Vendeur étudiant week-end', villes)).toBe('Vendeur');
    expect(nettoyerIntitule('Vendeuse extra soldes', villes)).toBe('Vendeuse');
    // Le lieu vient après le métier : tout ce qui le suit part, avec le mot qui l'introduit (mesure du 01/10/2026).
    expect(nettoyerIntitule('Vendeur.se Val Thoiry - 35 h/sem - CDI', new Set([...villes, 'thoiry']))).toBe('Vendeur');
    expect(nettoyerIntitule('Responsable boutique H.F', villes)).toBe('Responsable boutique');
    expect(nettoyerIntitule('CONSEILLERE ESTHETICIENNE POLYVALENTE EN ALTERNANCE', villes)).toBe('Conseillere estheticienne polyvalente');
    // Le titre natif n'est jamais réécrit.
    const natifs = await prisma.job.findMany({ where: { id: { in: ids } }, select: { title: true } });
    expect(natifs.map((n) => n.title).sort()).toEqual(OFFRES.flatMap((o) => Array.from({ length: o.n ?? 1 }, () => o.titre)).sort());
  });

  it('D-501 : une requête populaire au-delà du seuil, écrite dans un intitulé du marché ; jamais en dessous, jamais inventée', async () => {
    const j = JOURS_MIN_POPULAIRE;
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "RequeteTapee"("marche", "cle", "libelle", "occurrences", "jours") VALUES
      ('FR', 'conseillere de vente luxe', 'conseillère de vente luxe', ${SEUIL_POPULAIRE}, ${j}),
      ('FR', 'conseiller vente styliste', 'conseiller vente styliste', ${SEUIL_POPULAIRE - 1}, ${j}),
      ('FR', 'conseiller ignoble', 'conseiller ignoble', ${SEUIL_POPULAIRE * 50}, ${j}),
      ('FR', 'travaillerez boutique', 'travaillerez boutique', ${SEUIL_POPULAIRE * 50}, ${j}),
      ('FR', 'vendeur polyvalent toulouse', 'vendeur polyvalent toulouse', ${SEUIL_POPULAIRE * 50}, ${j - 1}),
      ('FR', 'conseillere de vente sans boutique', 'conseillère de vente sans boutique', ${SEUIL_POPULAIRE * 50}, ${j})`);
    // PRÉMISSE : « travaillerez boutique » mène à une offre (« Styliste », par sa description), mais aucun intitulé ne porte
    // ses deux mots.
    expect((await getJobs({ marche: 'FR', q: 'travaillerez boutique', comprendre: true, filtres: {} })).total).toBeGreaterThan(0);
    const s = await suggestTitlesCanoniques('conseill', exigerPerimetre('FR'), 'fr');
    expect(s).toContainEqual({ valeur: 'conseillère de vente luxe', metier: null, nature: 'populaire' });
    expect(s.map((x) => x.valeur)).not.toContain('conseiller vente styliste');
    // Une insistance sur moins de jours que le minimum ne fait pas une recherche populaire, même à 500 occurrences ; la même
    // requête, tapée sur assez de jours, en est une (prémisse : elle passe toutes les autres vérifications).
    const vendeur = async () => (await suggestTitlesCanoniques('vendeur', exigerPerimetre('FR'), 'fr')).map((x) => x.valeur);
    expect(await vendeur()).not.toContain('vendeur polyvalent toulouse');
    await prisma.$executeRaw(Prisma.sql`UPDATE "RequeteTapee" SET "jours" = ${j} WHERE "marche" = 'FR' AND "cle" = 'vendeur polyvalent toulouse'`);
    expect(await vendeur()).toContain('vendeur polyvalent toulouse');
    // Une négation n'est jamais suggérée : rien ne prouverait le mot exclu (audit technique).
    expect(s.map((x) => x.valeur)).not.toContain('conseillère de vente sans boutique');
    // Poussée au-delà du seuil, une suite de mots qu'aucun intitulé n'écrit ne devient pas une suggestion, même quand une
    // description la contient.
    expect(s.map((x) => x.valeur)).not.toContain('conseiller ignoble');
    expect((await suggestTitlesCanoniques('travail', exigerPerimetre('FR'), 'fr')).map((x) => x.valeur)).not.toContain('travaillerez boutique');
  });

  it('D-501 : la forme gardée est anonyme, repliée, bornée ; la purge efface ce qui reste sous le seuil', async () => {
    expect(formeGardee('Conseiller(ère) de vente H/F')).toEqual({ cle: 'conseiller de vente', libelle: 'conseiller de vente' });
    for (const refusee of ['75008', 'paris 75008', 'moi@exemple.fr', 'www.site.fr', 'un deux trois quatre cinq six sept', 'a', '!!'])
      expect(formeGardee(refusee), refusee).toBeNull();
    expect(await enregistrerRequete('FR', 'Vendeuse Chanel')).toBe(true);
    expect(await enregistrerRequete('FR', 'vendeuse  chanel')).toBe(true);
    expect(await enregistrerRequete('FR', '06 12 34 56 78')).toBe(false);
    const [ligne] = await prisma.$queryRaw<{ occurrences: number; libelle: string }[]>`SELECT "occurrences", "libelle" FROM "RequeteTapee" WHERE "marche" = 'FR' AND "cle" = 'vendeuse chanel'`;
    expect(ligne).toEqual({ occurrences: 2, libelle: 'vendeuse chanel' });
    // Aucune colonne ne peut porter une personne : marché, requête, compte, deux jours.
    const colonnes = await prisma.$queryRaw<{ c: string }[]>`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'RequeteTapee' ORDER BY ordinal_position`;
    expect(colonnes.map((c) => c.c)).toEqual(['marche', 'cle', 'libelle', 'occurrences', 'jours', 'premiereLe', 'derniereLe']);
    // Les jours distincts : deux occurrences le même jour comptent un jour.
    const [jour] = await prisma.$queryRaw<{ jours: number }[]>`SELECT "jours" FROM "RequeteTapee" WHERE "marche" = 'FR' AND "cle" = 'vendeuse chanel'`;
    expect(jour.jours).toBe(1);
    // Refusées à l'enregistrement : une négation, un critère de sexe, de grossesse ou de religion, un téléphone espacé.
    for (const refusee of ['vendeuse sans voile', 'vendeur homme', 'vendeuse enceinte', 'sales advisor not muslim', '06 12 34 56', 'ß'])
      expect(formeGardee(refusee), refusee).toBeNull();
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "RequeteTapee"("marche", "cle", "libelle", "occurrences", "premiereLe", "derniereLe") VALUES
      ('BE', 'vieille rare', 'vieille rare', 2, CURRENT_DATE - ${PURGE_JOURS + 10}::int, CURRENT_DATE - ${PURGE_JOURS + 1}::int),
      ('BE', 'vieille populaire', 'vieille populaire', ${SEUIL_POPULAIRE}, CURRENT_DATE - ${PURGE_JOURS + 10}::int, CURRENT_DATE - ${PURGE_JOURS + 1}::int),
      ('BE', 'recente rare', 'recente rare', 2, CURRENT_DATE - ${PURGE_JOURS + 10}::int, CURRENT_DATE - ${PURGE_JOURS - 1}::int),
      ('BE', 'oubliee populaire', 'oubliee populaire', ${SEUIL_POPULAIRE * 5}, CURRENT_DATE - ${CONSERVATION_MAX_JOURS + 30}::int, CURRENT_DATE - ${CONSERVATION_MAX_JOURS + 1}::int)`);
    expect(await purgerRequetes()).toBe(2);
    const restent = await prisma.$queryRaw<{ cle: string }[]>`SELECT "cle" FROM "RequeteTapee" WHERE "marche" = 'BE' ORDER BY "cle"`;
    expect(restent.map((r) => r.cle)).toEqual(['recente rare', 'vieille populaire']);
    // La garde de l'agrégateur : en production, rien n'est enregistré tant que la constante n'est pas levée (D-501).
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(await enregistrerRequete('FR', 'vendeuse chanel')).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
    const [apres] = await prisma.$queryRaw<{ occurrences: number }[]>`SELECT "occurrences" FROM "RequeteTapee" WHERE "marche" = 'FR' AND "cle" = 'vendeuse chanel'`;
    expect(apres.occurrences).toBe(2);
  });

  it('Q2 : les lieux de tête viennent de la base de lieux (« Paris (75) »), au contrat 2 seulement', async () => {
    const tete = await suggestLieuxDeTete(exigerPerimetre('FR'), 'fr');
    expect(tete[0]).toBe('Paris (75)');
    expect(tete.every((l) => /\(\d{2}\)$/.test(l))).toBe(true);
  });

  it('les routes : sans `x-catwalks-client: 2`, le contrat d’avant ; avec, les natures, les lieux de tête et la remise des requêtes', async () => {
    vi.stubEnv('CATALOGUE_API_KEY', 'cle-du-site');
    try {
      const { GET: suggerer } = await import('../../app/api/suggest/route');
      const { POST: remettre } = await import('../../app/api/requetes/route');
      const entetes = (client?: string) => ({ authorization: 'Bearer cle-du-site', ...(client ? { 'x-catwalks-client': client } : {}) });
      const appel = (chemin: string, client?: string) => new NextRequest(`http://catalogue.test${chemin}`, { headers: entetes(client) });
      const sans = await (await suggerer(appel('/api/suggest?type=title&q=conseill&marche=FR'))).json();
      expect(sans).not.toHaveProperty('natures');
      const avec = await (await suggerer(appel('/api/suggest?type=title&q=conseill&marche=FR', '2'))).json();
      expect(avec.natures[0]).toBe('metier');
      expect(avec.suggestions[0]).toBe('Conseiller de vente');
      expect((await (await suggerer(appel('/api/suggest?type=city&q=&marche=FR'))).json()).suggestions).toEqual([]);
      expect((await (await suggerer(appel('/api/suggest?type=city&q=&marche=FR', '2'))).json()).suggestions[0]).toBe('Paris (75)');
      const poste = (corps: unknown, client?: string, cle = 'cle-du-site') => remettre(new NextRequest('http://catalogue.test/api/requetes',
        { method: 'POST', body: JSON.stringify(corps), headers: { ...entetes(client), authorization: `Bearer ${cle}`, 'content-type': 'application/json' } }));
      expect((await poste({ marche: 'FR', q: 'chef de rayon' }, '2', 'mauvaise')).status).toBe(401);
      expect(await (await poste({ marche: 'FR', q: 'chef de rayon' })).json()).toEqual({ enregistree: false });
      const r = await poste({ marche: 'FR', q: 'chef de rayon' }, '2');
      expect(r.status).toBe(202);
      expect(await r.json()).toEqual({ enregistree: true });
      expect((await poste({ marche: 'ZZ', q: 'chef de rayon' }, '2')).status).toBe(400);
      expect((await poste({ q: 42 }, '2')).status).toBe(400);
      const [l] = await prisma.$queryRaw<{ n: number }[]>`SELECT "occurrences" AS n FROM "RequeteTapee" WHERE "marche" = 'FR' AND "cle" = 'chef de rayon'`;
      expect(l.n).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
