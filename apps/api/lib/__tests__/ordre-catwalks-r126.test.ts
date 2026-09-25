import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, prisma } from '@catwalks/db';
import * as database from '@catwalks/db/occupations';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { offreListe } from '../../../aggregator/src/direct/fixture';
import { chargerContexte } from '../../../aggregator/src/direct/contexte';
import { synchroniserListe } from '../../../aggregator/src/direct/photo';
import { directPubliable } from '../direct-offers';
import { drainSearchIndex, getSearchContext, initializeSearchIndex, SEARCH_VERSION } from '../search-index';
import { searchSql } from '../search-sql';
import { getJobStatus, getJobs, type JobFilters } from '../jobs';
import { getCompanies } from '../companies';

/**
 * R-126 (D-419 §1, confirmée le 25/09/2026) — LES OFFRES CATWALKS PASSENT AVANT TOUTE OFFRE AGRÉGÉE, sans filtre, avec
 * filtres, avec mots-clés, sur toutes les pages ; ensuite le pays du visiteur, puis la fraîcheur. Sur une vraie base, par
 * la vraie chaîne : la liste publique lue par le lecteur de D-444 (`synchroniserListe`, registre et taxonomie de la base),
 * l'index de recherche, `getJobs`.
 *
 * Chaque cas pose sa PRÉMISSE : les offres agrégées y sont plus fraîches, plus pertinentes, ou dans le pays du visiteur —
 * ce qui, sans la règle, les mettrait devant.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);

const D = 'ordreR126';
const A = 'ordre-r126';
const MAISON = 'Maison Ordre R126';
const AUTRE = 'Autre Maison R126';
const GROUPE = 'Groupe Ordre R126';
/** Une Maison du registre à l'apostrophe typographique, que le backend écrit avec l'apostrophe droite. */
const APOSTROPHE_REGISTRE = 'L’Apostrophe R126';
const APOSTROPHE_BACKEND = "L'Apostrophe R126";
const DIRECTES_FR = 30;
const AGREGEES_FR = 30;
const PARIS = { latitude: 48.8666, longitude: 2.3048 };

const directe = (id: string, surcharges: Record<string, unknown> = {}) => offreListe({
  id: `${D}${id}`, slug: `${A}-${id.toLowerCase()}`, title: 'Conseiller de vente H/F', maison: { name: MAISON, slug: 'maison-ordre-r126' },
  location: 'Paris 8e', ...PARIS, contractType: 'CDI', sectors: ['MODE'], specializations: [],
  jobDescription: 'Accueillir la clientèle en boutique.', missions: 'Accueil et vente.', profile: 'Trois ans d’expérience.',
  publishedAt: new Date(Date.UTC(2026, 7, 1, 0, Number(id.replace(/\D/g, '') || 0))).toISOString(), ...surcharges,
});
const LISTE = [
  ...Array.from({ length: DIRECTES_FR }, (_, i) => directe(`Fr${String(i).padStart(2, '0')}`)),
  directe('Mandat', { maison: null, title: 'Responsable de boutique', contractType: 'CDD', publishedAt: '2026-08-15T00:00:00.000Z',
    jobCategoryRef: { slug: 'RESPONSABLE_BOUTIQUE', label: 'Responsable de boutique' } }),
  // La ville et le code postal suivent le lieu (D-468 §1) : le jeu d'essai partagé les met à Paris par défaut.
  directe('Berlin', { location: 'Berlin — Kurfürstendamm', city: 'Berlin', postalCode: null, latitude: 52.5043937, longitude: 13.3353476 }),
  // Plus ancienne que Berlin, mais dans le pays d'un visiteur autrichien.
  directe('Vienne', { location: 'Wien — Kärntner Straße', city: 'Vienne', postalCode: null, latitude: 48.2049, longitude: 16.3718, publishedAt: '2026-07-01T00:00:00.000Z' }),
  // Un intitulé en écriture inclusive : la taxonomie le classe, la recherche n'y lit aucun rôle (H2 de l'audit).
  directe('Inclusif', { title: 'Conseiller·ère de vente' }),
  // La même Maison, écrite autrement par le backend : rattachée au registre, une seule option « Maison ».
  directe('Casse', { title: 'Responsable de boutique', maison: { name: 'MAISON ORDRE R126', slug: 'maison-ordre-r126' },
    jobCategoryRef: { slug: 'RESPONSABLE_BOUTIQUE', label: 'Responsable de boutique' } }),
  // Une autre Maison, écrite par le backend avec une apostrophe droite que le registre écrit typographique.
  directe('Apostrophe', { title: 'Responsable de boutique', maison: { name: APOSTROPHE_BACKEND, slug: 'l-apostrophe-r126' },
    jobCategoryRef: { slug: 'RESPONSABLE_BOUTIQUE', label: 'Responsable de boutique' } }),
];
const TITRE_AGREGE = 'Conseiller de vente conseiller conseiller';

type Agregee = { id: string; pays: string; ville: string };
/** Deux offres agrégées de la Maison à l'apostrophe, au nom du registre : hors du préfixe `-agg-` des autres témoins. */
const AGREGEES_APOSTROPHE = [`${A}-apostrophe-agg-0`, `${A}-apostrophe-agg-1`];
const AGREGEES: Agregee[] = [
  ...Array.from({ length: AGREGEES_FR }, (_, i) => ({ id: `fr-${String(i).padStart(2, '0')}`, pays: 'FR', ville: 'Paris' })),
  { id: 'at-0', pays: 'AT', ville: 'Wien' },
  { id: 'at-1', pays: 'AT', ville: 'Wien' },
];

const chercher = (marche: string, filtres: JobFilters['filtres'] = {}, extra: Partial<JobFilters> = {}) => getJobs({ marche, ...extra, filtres });
const estDirecte = (id: string) => id.startsWith(`cw_${D}`);
const estAgregee = (id: string) => id.startsWith(`${A}-agg-`);
/** Toutes les pages d'une recherche, dans l'ordre servi. */
async function toutes(marche: string, filtres: JobFilters['filtres'] = {}, extra: Partial<JobFilters> = {}) {
  const pages: string[][] = [];
  let apres: string | undefined;
  do {
    const r = await chercher(marche, filtres, { ...extra, apres });
    pages.push(r.jobs.map((j) => j.id));
    apres = r.suivant ?? undefined;
  } while (apres && pages.length < 20);
  return pages;
}
/** Dans l'ordre servi, restreint aux offres du témoin : aucune agrégée avant une directe. */
const catwalksDabord = (ids: string[]) => {
  const miens = ids.filter((id) => estDirecte(id) || estAgregee(id));
  const premiereAgregee = miens.findIndex(estAgregee);
  return premiereAgregee === -1 || miens.slice(premiereAgregee).every(estAgregee);
};

describe.skipIf(!enabled)('R-126 — les offres Catwalks d’abord, sur toutes les pages (D-444)', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { job: { id: { startsWith: `${A}-agg-` } } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: `${A}-agg-` } } });
    await prisma.jobSource.deleteMany({ where: { job: { id: { in: AGREGEES_APOSTROPHE } } } });
    await prisma.job.deleteMany({ where: { id: { in: AGREGEES_APOSTROPHE } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: `${A}-` } } });
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: D } } });
    await prisma.directFeedCursor.deleteMany({ where: { id: 'catwalks-liste' } });
  };

  beforeAll(async () => {
    await nettoyer();
    // La Maison des offres Catwalks est au registre, rattachée à un groupe ; une autre Maison du groupe publie les agrégées.
    await prisma.company.create({ data: { id: `${A}-maison`, name: MAISON, canonicalKey: `${A}-maison`, fashionjobsUrl: `resolved:${A}-maison`, parentGroup: GROUPE } });
    await prisma.company.create({ data: { id: `${A}-autre`, name: AUTRE, canonicalKey: `${A}-autre`, fashionjobsUrl: `resolved:${A}-autre`, parentGroup: GROUPE } });
    await prisma.company.create({ data: { id: `${A}-apostrophe`, name: APOSTROPHE_REGISTRE, canonicalKey: `${A}-apostrophe`, fashionjobsUrl: `resolved:${A}-apostrophe` } });
    const catalogue = await database.loadOccupationTaxonomy(prisma);
    for (const g of AGREGEES) {
      const lien = `https://example.com/${A}/${g.id}`;
      const fraiche = new Date('2026-09-24T08:00:00Z');
      await prisma.job.create({ data: {
        id: `${A}-agg-${g.id}`, companyId: `${A}-autre`, source: 'GENERIC_JSONLD', externalId: g.id, title: TITRE_AGREGE, url: lien, city: g.ville,
        countryCode: g.pays, employmentTerm: 'PERMANENT', language: 'fr', isActive: true, postedAt: fraiche, firstSeenAt: fraiche,
        description: 'Conseiller de vente : conseiller la clientèle, conseiller sur les collections, conseiller en boutique.',
        ...database.persistedOccupationDecision(catalogue.classify(TITRE_AGREGE)),
        sources: { create: { sourceKey: A, sourceTier: 'ATS_OFFICIAL', externalId: g.id, url: lien, isActive: true,
          ...publicationFixture({ sourceKey: A, sourceTier: 'ATS_OFFICIAL', externalId: g.id, url: lien, title: TITRE_AGREGE, city: g.ville,
            country: g.pays, employmentTerm: 'PERMANENT', language: 'fr', postedAt: fraiche }) } },
      } });
    }
    for (const id of AGREGEES_APOSTROPHE) {
      const lien = `https://example.com/${A}/${id}`, titre = 'Responsable de boutique', fraiche = new Date('2026-09-24T08:00:00Z');
      await prisma.job.create({ data: {
        id, companyId: `${A}-apostrophe`, source: 'GENERIC_JSONLD', externalId: id, title: titre, url: lien, city: 'Paris', countryCode: 'FR',
        employmentTerm: 'PERMANENT', language: 'fr', isActive: true, postedAt: fraiche, firstSeenAt: fraiche, description: 'Diriger la boutique.',
        ...database.persistedOccupationDecision(catalogue.classify(titre)),
        sources: { create: { sourceKey: A, sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, isActive: true,
          ...publicationFixture({ sourceKey: A, sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, title: titre, city: 'Paris',
            country: 'FR', employmentTerm: 'PERMANENT', language: 'fr', postedAt: fraiche }) } },
      } });
    }
    // Les offres Catwalks entrent par le lecteur de D-444, depuis la forme réelle de la liste publique.
    const stats = await synchroniserListe(prisma, { async lire() { return structuredClone(LISTE); },
      async compter() { return { contractTypes: [{ value: 'CDI', count: LISTE.length }] }; } }, { contexte: await chargerContexte(prisma) });
    expect(stats).toMatchObject({ complete: true, publiees: LISTE.length, parPays: { FR: DIRECTES_FR + 4, DE: 1, AT: 1 } });
    await initializeSearchIndex();
    while (await drainSearchIndex()) {}
  }, 180_000);
  afterAll(nettoyer);

  it('PRÉMISSE — les agrégées sont plus fraîches ; les directes sont rattachées au groupe et classées par la taxonomie', async () => {
    const directes = await prisma.directOffer.findMany({ where: { id: { startsWith: `${D}Fr` } } });
    expect(directes).toHaveLength(DIRECTES_FR);
    expect(new Set(directes.map((d) => d.companyId))).toEqual(new Set([`${A}-maison`]));
    expect(new Set(directes.map((d) => d.occupationCode))).toEqual(new Set(['sales-advisor']));
    const agregees = await prisma.job.findMany({ where: { id: { startsWith: `${A}-agg-fr` } }, select: { postedAt: true, occupationCode: true } });
    expect(new Set(agregees.map((j) => j.occupationCode))).toEqual(new Set(['sales-advisor']));
    const plusRecenteDirecte = Math.max(...directes.map((d) => d.postedAt.getTime()));
    expect(agregees.every((j) => j.postedAt!.getTime() > plusRecenteDirecte)).toBe(true);
  });

  it('sans filtre : toutes les offres Catwalks du marché, puis les agrégées ; la page 2 prolonge l’ordre sans doublon', async () => {
    const pages = await toutes('FR');
    const ids = pages.flat();
    expect(new Set(ids).size).toBe(ids.length);
    // PRÉMISSE : il y a plus d'offres Catwalks qu'une page n'en montre — la page 2 commence par des offres Catwalks.
    const publiables = await prisma.directOffer.count({ where: { ...directPubliable(), countryCode: 'FR' } });
    expect(publiables).toBeGreaterThan(pages[0].length);
    expect(pages[0].every((id) => id.startsWith('cw_'))).toBe(true);
    expect(pages[1][0].startsWith('cw_')).toBe(true);
    // Toutes les offres Catwalks publiables en France, et elles seules, ouvrent la liste.
    expect(ids.slice(0, publiables).every((id) => id.startsWith('cw_'))).toBe(true);
    expect(ids.slice(publiables).some((id) => id.startsWith('cw_'))).toBe(false);
    expect(ids.filter(estAgregee)).toHaveLength(AGREGEES_FR);
    // Entre offres Catwalks, la fraîcheur : le mandat, plus récent que les trente autres, les précède.
    expect(ids.filter(estDirecte)[0]).toBe(`cw_${D}Mandat`);
  });

  it('avec un mot-clé : une offre Catwalks moins pertinente passe devant une agrégée plus pertinente, sur toutes les pages', async () => {
    const q = 'conseiller';
    const { model } = await getSearchContext();
    const recherche = searchSql(model.resolver.resolve(q));
    const scores = await prisma.$queryRaw<{ id: string; score: number }[]>(Prisma.sql`
      SELECT s.id, ${recherche.score} AS score FROM "SearchDocument" s WHERE s.version = ${SEARCH_VERSION}
        AND s.id IN (${`cw_${D}Fr00`}, ${`${A}-agg-fr-00`})`);
    const score = Object.fromEntries(scores.map((s) => [s.id, s.score]));
    // PRÉMISSE : l'agrégée est plus pertinente que l'offre Catwalks pour ce mot.
    expect(score[`${A}-agg-fr-00`]).toBeGreaterThan(score[`cw_${D}Fr00`]);
    const pages = await toutes('FR', {}, { q, prioritePays: 'FR' });
    const ids = pages.flat();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith(`cw_${D}Fr`))).toHaveLength(DIRECTES_FR);
    expect(pages.length).toBeGreaterThan(1);
    expect(catwalksDabord(ids)).toBe(true);
    expect(pages[0].filter((id) => estDirecte(id) || estAgregee(id)).every(estDirecte)).toBe(true);
  });

  it('le pays du visiteur ne passe pas devant l’origine : une offre Catwalks à Berlin précède les agrégées de Vienne pour un visiteur autrichien', async () => {
    const r = await chercher('DE', {}, { prioritePays: 'AT' });
    const miens = r.jobs.map((j) => j.id).filter((id) => estDirecte(id) || estAgregee(id));
    // PRÉMISSE : les agrégées sont dans le pays du visiteur (AT) et plus fraîches ; l'offre Catwalks de Berlin est en Allemagne.
    expect(r.jobs.find((j) => j.id === `cw_${D}Berlin`)?.countryCode).toBe('DE');
    expect(r.jobs.find((j) => j.id === `cw_${D}Vienne`)?.countryCode).toBe('AT');
    expect(r.jobs.filter((j) => estAgregee(j.id)).map((j) => j.countryCode)).toEqual(['AT', 'AT']);
    // Dans le groupe Catwalks, le pays du visiteur, puis la fraîcheur : Vienne, plus ancienne, passe devant Berlin.
    expect(miens).toEqual([`cw_${D}Vienne`, `cw_${D}Berlin`, `${A}-agg-at-0`, `${A}-agg-at-1`]);
    // Sans pays de visiteur, la fraîcheur seule : Berlin, plus récente, passe devant Vienne ; l'origine d'abord, toujours.
    const sansVisiteur = (await chercher('DE')).jobs.map((j) => j.id).filter((id) => estDirecte(id) || estAgregee(id));
    expect(sansVisiteur).toEqual([`cw_${D}Berlin`, `cw_${D}Vienne`, `${A}-agg-at-0`, `${A}-agg-at-1`]);
  });

  it('avec filtres — secteur, contrat, métier, groupe : les offres Catwalks sont dans les résultats, et devant', async () => {
    for (const filtres of [{ secteur: ['FASHION'] }, { contrat: ['PERMANENT'] }, { metier: ['sales-advisor'] }, { groupe: [GROUPE] }] as JobFilters['filtres'][]) {
      const pages = await toutes('FR', filtres);
      const ids = pages.flat();
      const cle = JSON.stringify(filtres);
      expect(new Set(ids).size, cle).toBe(ids.length);
      // Les 30 offres Catwalks de la Maison répondent à chacun de ces filtres (le mandat, en CDD et sans Maison, à aucun des deux derniers).
      expect(ids.filter((id) => id.startsWith(`cw_${D}Fr`)), cle).toHaveLength(DIRECTES_FR);
      expect(catwalksDabord(ids), cle).toBe(true);
      expect(pages[0][0].startsWith('cw_'), cle).toBe(true);
    }
    // Les agrégées du groupe et du métier y sont aussi : le filtre ne les a pas remplacées.
    expect((await toutes('FR', { groupe: [GROUPE] })).flat().filter(estAgregee)).toHaveLength(AGREGEES_FR);
    expect((await toutes('FR', { metier: ['sales-advisor'] })).flat().filter(estAgregee)).toHaveLength(AGREGEES_FR);
  });

  it('D-468 §1 — le filtre « Ville » trouve les offres Catwalks par la ville de la liste, et devant', async () => {
    // PRÉMISSE : la ville des offres Catwalks vient de la liste (champ `city`), leur libellé de lieu ne la porte pas seul.
    expect(await prisma.directOffer.count({ where: { id: { startsWith: `${D}Fr` }, city: 'Paris', location: 'Paris 8e' } })).toBe(DIRECTES_FR);
    const pages = await toutes('FR', { ville: ['Paris'] });
    const ids = pages.flat();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith(`cw_${D}Fr`))).toHaveLength(DIRECTES_FR);
    expect(ids.filter(estAgregee)).toHaveLength(AGREGEES_FR);
    expect(catwalksDabord(ids)).toBe(true);
    // Berlin et Vienne ne sont pas à Paris.
    expect(ids).not.toContain(`cw_${D}Berlin`);
  });

  it('les facettes « groupe » et « métier » comptent les offres Catwalks', async () => {
    // La Maison au registre : les 30, l'intitulé inclusif et l'offre au nom écrit en capitales (rattachée elle aussi).
    const r = await chercher('FR', { maison: [MAISON] });
    expect(r.facettes.find((f) => f.cle === 'groupe')?.options.find((o) => o.value === GROUPE)?.count).toBe(DIRECTES_FR + 2);
    const metier = await chercher('FR', { maison: [MAISON], metier: ['sales-advisor'] });
    expect(metier.total).toBe(DIRECTES_FR + 1);
    expect(metier.facettes.find((f) => f.cle === 'metier')?.options.find((o) => o.value === 'sales-advisor')?.count).toBe(DIRECTES_FR + 1);
  });

  it('une Maison que le backend écrit autrement que le registre n’a qu’une option « Maison », au nom du registre, qui trouve toutes ses offres', async () => {
    // PRÉMISSE : l'offre affiche le nom du backend, en capitales, et elle est rattachée à la société du registre.
    const casse = await prisma.directOffer.findUniqueOrThrow({ where: { id: `${D}Casse` } });
    expect(casse).toMatchObject({ company: 'MAISON ORDRE R126', companyId: `${A}-maison` });
    const r = await chercher('FR');
    const options = r.facettes.find((f) => f.cle === 'maison')!.options.filter((o) => o.value.toLowerCase() === MAISON.toLowerCase());
    expect(options.map((o) => o.value)).toEqual([MAISON]);
    const ids = (await toutes('FR', { maison: [MAISON] })).flat();
    expect(ids).toContain(`cw_${D}Casse`);
    // La ligne servie, elle, garde le nom que le backend publie (D-455).
    const statut = await getJobStatus(`cw_${D}Casse`);
    expect(statut.status === 'active' ? statut.job.company : statut.status).toBe('MAISON ORDRE R126');
  });

  it('un mot-clé de métier trouve une offre Catwalks dont l’intitulé ne nomme pas le rôle mot pour mot, par le métier de la taxonomie', async () => {
    // PRÉMISSE : la taxonomie classe « Conseiller·ère de vente » ; la recherche n'y lit aucun rôle de titre.
    expect((await prisma.directOffer.findUniqueOrThrow({ where: { id: `${D}Inclusif` } })).occupationCode).toBe('sales-advisor');
    const [document] = await prisma.$queryRaw<{ roles: string[] }[]>(Prisma.sql`
      SELECT ARRAY(SELECT jsonb_array_elements_text(document->'titleRoles')) AS roles FROM "SearchDocument" WHERE version = ${SEARCH_VERSION} AND id = ${`cw_${D}Inclusif`}`);
    expect(document.roles).toEqual([]);
    const ids = (await toutes('FR', {}, { q: 'conseiller de vente' })).flat();
    expect(ids).toContain(`cw_${D}Inclusif`);
    expect(catwalksDabord(ids)).toBe(true);
  });

  it('le nom que le backend publie retrouve toujours ses offres, et l’annuaire n’a qu’une ligne par Maison, au nom du registre', async () => {
    // PRÉMISSE : les deux offres sont rattachées au registre sous un nom qui diffère de celui du backend, au-delà de la
    // casse pour l'apostrophe ; l'annuaire les regroupait jusqu'ici par le nom exact.
    const apostrophe = await prisma.directOffer.findUniqueOrThrow({ where: { id: `${D}Apostrophe` } });
    expect(apostrophe).toMatchObject({ company: APOSTROPHE_BACKEND, companyId: `${A}-apostrophe` });
    expect(APOSTROPHE_BACKEND.toLowerCase()).not.toBe(APOSTROPHE_REGISTRE.toLowerCase());
    // PRÉMISSE : la Maison a aussi des offres agrégées, publiées sous le nom du registre, aucun alias pour l'apostrophe droite.
    expect(await prisma.job.count({ where: { id: { in: AGREGEES_APOSTROPHE }, companyId: `${A}-apostrophe` } })).toBe(AGREGEES_APOSTROPHE.length);
    expect(await prisma.companyAlias.count({ where: { companyId: `${A}-apostrophe` } })).toBe(0);
    // Un lien bâti sur le nom de la carte (bloc Maison, fiche fermée, suggestion) comme sur l'option « Maison » trouve TOUTES
    // les offres de la Maison : l'offre Catwalks et ses offres agrégées.
    for (const nom of [APOSTROPHE_BACKEND, APOSTROPHE_REGISTRE])
      expect(new Set((await toutes('FR', { maison: [nom] })).flat()), nom).toEqual(new Set([`cw_${D}Apostrophe`, ...AGREGEES_APOSTROPHE]));
    expect((await toutes('FR', { maison: ['MAISON ORDRE R126'] })).flat()).toContain(`cw_${D}Casse`);
    // Une seule option « Maison » pour elle, au nom du registre.
    const options = (await chercher('FR')).facettes.find((f) => f.cle === 'maison')!.options.map((o) => o.value).filter((v) => /apostrophe r126/i.test(v));
    expect(options).toEqual([APOSTROPHE_REGISTRE]);
    // L'annuaire : une ligne par Maison, au nom du registre, qui compte toutes ses offres (les 30, l'inclusive, la capitale).
    const ordre = (await getCompanies({ marche: 'FR', q: 'Ordre R126' })).companies.filter((c) => /ordre r126/i.test(c.name));
    expect(ordre.map((c) => ({ name: c.name, jobCount: c.jobCount, group: c.group }))).toEqual([{ name: MAISON, jobCount: DIRECTES_FR + 2, group: GROUPE }]);
    const lignes = (await getCompanies({ marche: 'FR', q: 'Apostrophe R126' })).companies.filter((c) => /apostrophe r126/i.test(c.name));
    expect(lignes.map((c) => ({ id: c.id, name: c.name, jobCount: c.jobCount }))).toEqual([{ id: `${A}-apostrophe`, name: APOSTROPHE_REGISTRE, jobCount: 1 + AGREGEES_APOSTROPHE.length }]);
  });
});
