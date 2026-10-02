import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { examinerAlerte, getJobs, type JobFilters } from '../jobs';
import { searchSummary } from '../job-search-query';
import { planifierRecherche } from '../search-plan';
import { exigerPerimetre } from '../perimetre';
import { drainSearchIndex, initializeSearchIndex } from '../search-index';

/**
 * D-515 §1, R-143 §10 (lecture D-492 du 02/10/2026, suites du classement) — UNE DONNÉE INCONNUE NE DEVIENT JAMAIS UNE
 * DONNÉE NÉGATIVE, AUSSI POUR LE SECTEUR, LA LANGUE ET LE PROGRAMME.
 *
 * Défaut gardé : au contrat 2, un filtre « Beauté » écartait toute offre d'une Maison sans secteur (33 907 offres servies
 * sur 85 282 le 02/10/2026), un filtre « français » toute offre dont la langue du texte n'est pas détectée (1 392),
 * comme si elles étaient d'un autre secteur ou d'une autre langue. Attendu (arbitrage du 02/10/2026) : la liste, ses
 * facettes et son compte ne portent que les reconnues ; les non précisées forment une section À PART (`section:
 * 'inconnues'`), signalées ; une valeur connue et contraire n'est dans aucune des deux ; une alerte ne les envoie, à
 * part, que si son métier ou son lieu est confirmé (D-515 §2). Le contrat 1 (sans en-tête) garde le filtre strict d'avant.
 *
 * PRÉMISSE de chaque témoin : l'offre inconnue est la PLUS FRAÎCHE. Mêlée à la liste, elle passerait devant la reconnue ;
 * écartée de la section, elle y manquerait : le témoin échoue dans les deux cas.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const P = 'd515-inconnu-';
const M = { beaute: `${P}beaute`, mode: `${P}mode`, sans: `${P}sans` } as const;
const PREUVE = (code: string) => [{ code, source: 'https://example.com/officiel', statement: 'Témoin D-515', confidence: 'HIGH', basis: 'OFFICIAL_SOURCE', checkedAt: '2026-10-02T00:00:00Z' }];
const SECTEURS: Record<string, string> = { [M.beaute]: 'BEAUTY', [M.mode]: 'FASHION' };
const MANIFESTE = { reviewer: 'temoin-d515', companies: Object.entries(SECTEURS).map(([id, code]) => ({ id, canonicalKey: id, codes: [code], evidence: PREUVE(code) })) };
const REVUE = `${P}revue-${createHash('sha256').update(JSON.stringify(MANIFESTE)).digest('hex').slice(0, 16)}`;

type Offre = { id: string; maison: string; heure: number; language?: string | null; employmentTerm?: string };
/** `heure` : l'heure d'entrée au catalogue le 29/09 ; plus grande = plus fraîche. */
const OFFRES: Offre[] = [
  { id: 'beaute-fr', maison: M.beaute, heure: 1, language: 'fr', employmentTerm: 'PERMANENT' },
  { id: 'mode-en', maison: M.mode, heure: 20, language: 'en', employmentTerm: 'PERMANENT' },
  { id: 'sans-secteur-sans-langue', maison: M.sans, heure: 22, language: null },
  { id: 'sans-secteur-langue-vide', maison: M.sans, heure: 23, language: '', employmentTerm: 'FIXED_TERM' },
];
const FILIGRANE = new Date('2026-09-29T00:00:00Z');
const BORNE_PUBLICATION = new Date('2026-09-01T00:00:00Z');

describe.skipIf(!enabled)('D-515 §1 — secteur, langue et programme : l’inconnu n’est pas un désaccord', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: P } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: P } } });
    await initializeSearchIndex();
    while (await drainSearchIndex()) { /* index à jour */ }
  };
  beforeAll(async () => {
    await nettoyer();
    await prisma.sectorReview.createMany({ skipDuplicates: true, data: [{ id: REVUE, reviewer: MANIFESTE.reviewer, before: [], manifest: MANIFESTE }] });
    for (const m of Object.values(M)) {
      const code = SECTEURS[m];
      await prisma.company.create({ data: { id: m, name: m, canonicalKey: m, fashionjobsUrl: `resolved:${m}`, sector: 'LUXURY',
        ...(code ? { sectorCodes: [code], sectorEvidence: PREUVE(code), sectorReviewId: REVUE } : {}) } });
    }
    for (const o of OFFRES) {
      const id = `${P}${o.id}`, lien = `https://example.com/${id}`, entree = new Date(Date.UTC(2026, 8, 29, o.heure));
      await prisma.job.create({ data: { id, companyId: o.maison, source: 'GENERIC_JSONLD', externalId: id, title: 'Conseiller de vente', url: lien,
        countryCode: 'FR', city: 'Paris', isActive: true, postedAt: entree, firstSeenAt: entree, language: o.language ?? null,
        employmentTerm: o.employmentTerm ?? null,
        sources: { create: { sourceKey: 'd515', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, isActive: true,
          ...publicationFixture({ sourceKey: 'd515', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, title: 'Conseiller de vente', country: 'FR' }) } },
      } });
    }
    while (await drainSearchIndex()) { /* index à jour */ }
  }, 120_000);
  afterAll(nettoyer);

  const maisons = Object.values(M);
  const contrat2 = (filtres: JobFilters['filtres']): JobFilters =>
    ({ marche: 'FR', fraicheur: true, comprendre: true, nonPrecisees: true, filtres: { maison: maisons, ...filtres } });
  const contrat1 = (filtres: JobFilters['filtres']): JobFilters => ({ marche: 'FR', filtres: { maison: maisons, ...filtres } });
  const court = (ids: string[]) => ids.map((id) => id.slice(P.length));
  const heure = (id: string) => OFFRES.find((o) => o.id === id)!.heure;

  it('PRÉMISSE : les offres sans secteur ni langue sont plus fraîches que les reconnues, et la base les porte bien inconnues', async () => {
    expect(Math.min(heure('sans-secteur-sans-langue'), heure('sans-secteur-langue-vide'))).toBeGreaterThan(Math.max(heure('beaute-fr'), heure('mode-en')));
    const sans = await prisma.company.findUniqueOrThrow({ where: { id: M.sans } });
    expect(sans.sectorCodes).toEqual([]);
  });

  it('« Beauté » au contrat 2 : la liste ne porte que la Maison de beauté ; ses facettes et son compte aussi', async () => {
    const r = await getJobs(contrat2({ secteur: ['BEAUTY'] }));
    expect(court(r.jobs.map((j) => j.id))).toEqual(['beaute-fr']);
    expect(r.total).toBe(1);
    expect(r.totalConfirmes).toBe(1);
    // La facette Maison se calcule sur les confirmées seules : la Maison sans secteur n'y est pas.
    const plan = planifierRecherche(exigerPerimetre('FR'), { filtres: { maison: maisons, secteur: ['BEAUTY'] }, fraicheur: true, nonPrecisees: true });
    const brut = await searchSummary(plan, null, 25);
    expect(brut.facettes.maison.map((f) => f.value)).toEqual([M.beaute]);
  });

  it('« Beauté », section des inconnues : les Maisons sans secteur, à part, signalées ; la Maison de mode dans aucune des deux', async () => {
    const r = await getJobs({ ...contrat2({ secteur: ['BEAUTY'] }), section: 'inconnues' });
    expect(court(r.jobs.map((j) => j.id))).toEqual(['sans-secteur-langue-vide', 'sans-secteur-sans-langue']);
    expect(r.total).toBe(2);
    expect(r.totalConfirmes).toBe(0);
    expect(r.jobs.map((j) => j.correspondance)).toEqual([
      { statut: 'NON_CONFIRMEE', dimensions: ['secteur'] }, { statut: 'NON_CONFIRMEE', dimensions: ['secteur'] }]);
    expect(r.suivant).toBeNull();
    // Au classement pertinent (une requête tapée), la même section, classée.
    const classee = await getJobs({ ...contrat2({ secteur: ['BEAUTY'] }), q: 'conseiller de vente', section: 'inconnues' });
    expect(court(classee.jobs.map((j) => j.id)).sort()).toEqual(['sans-secteur-langue-vide', 'sans-secteur-sans-langue']);
    expect(classee.jobs.every((j) => j.classement !== undefined)).toBe(true);
  });

  it('« Non classé » demande les offres sans secteur : elles sont la liste, reconnues, et la section est vide', async () => {
    const r = await getJobs(contrat2({ secteur: ['unclassified'] }));
    expect(court(r.jobs.map((j) => j.id)).sort()).toEqual(['sans-secteur-langue-vide', 'sans-secteur-sans-langue']);
    expect(r.totalConfirmes).toBe(2);
    expect(r.jobs.every((j) => j.correspondance?.statut === 'CONFIRMEE')).toBe(true);
    expect((await getJobs({ ...contrat2({ secteur: ['unclassified'] }), section: 'inconnues' })).total).toBe(0);
  });

  it('« français » : le texte français dans la liste ; les langues non détectées (absente ou vide) à part ; l’anglais nulle part', async () => {
    const r = await getJobs(contrat2({ langue: ['fr'] }));
    expect(court(r.jobs.map((j) => j.id))).toEqual(['beaute-fr']);
    const inconnues = await getJobs({ ...contrat2({ langue: ['fr'] }), section: 'inconnues' });
    expect(court(inconnues.jobs.map((j) => j.id))).toEqual(['sans-secteur-langue-vide', 'sans-secteur-sans-langue']);
    expect(inconnues.jobs.every((j) => j.correspondance?.statut === 'NON_CONFIRMEE' && j.correspondance.dimensions.join() === 'langue')).toBe(true);
  });

  it('plusieurs inconnues se nomment ensemble ; une valeur connue et contraire sur l’une suffit à écarter', async () => {
    const r = await getJobs({ ...contrat2({ secteur: ['BEAUTY'], contrat: ['PERMANENT'] }), section: 'inconnues' });
    // « sans-secteur-langue-vide » déclare un CDD : écartée malgré son secteur inconnu.
    expect(court(r.jobs.map((j) => j.id))).toEqual(['sans-secteur-sans-langue']);
    expect(r.jobs[0].correspondance).toEqual({ statut: 'NON_CONFIRMEE', dimensions: ['contrat', 'secteur'] });
  });

  it('contrat 1 (sans en-tête) : le filtre strict d’avant, à l’identique, et la section n’existe pas', async () => {
    for (const [filtres, attendu] of [[{ secteur: ['BEAUTY'] }, ['beaute-fr']], [{ langue: ['fr'] }, ['beaute-fr']]] as const) {
      for (const section of [undefined, 'inconnues' as const]) {
        const r = await getJobs({ ...contrat1(filtres), ...(section ? { section } : {}) });
        expect(court(r.jobs.map((j) => j.id))).toEqual(attendu);
        expect(r.total).toBe(1);
      }
    }
  });

  it('l’alerte « Beauté » seule ne correspond pas fortement : elle n’envoie que la confirmée, aucune inconnue', async () => {
    const examen = await examinerAlerte(contrat2({ secteur: ['BEAUTY'] }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(examen.jobs.map((j) => j.id))).toEqual(['beaute-fr']);
    expect(examen.total).toBe(1);
    expect(examen.incompletes).toBe(0);
    expect(examen.jobsIncompletes).toEqual([]);
  });

  it('l’alerte « Beauté » avec un métier tapé, ou un lieu, confirmés : les Maisons sans secteur partent à part, nommées', async () => {
    for (const extra of [{ q: 'conseiller de vente' }, { lieu: 'Paris' }]) {
      const examen = await examinerAlerte({ ...contrat2({ secteur: ['BEAUTY'] }), ...extra }, FILIGRANE, BORNE_PUBLICATION);
      expect(court(examen.jobs.map((j) => j.id)), JSON.stringify(extra)).toEqual(['beaute-fr']);
      expect(examen.total).toBe(1);
      expect(examen.incompletes).toBe(2);
      expect(court((examen.jobsIncompletes ?? []).map((j) => j.id))).toEqual(['sans-secteur-langue-vide', 'sans-secteur-sans-langue']);
      expect((examen.jobsIncompletes ?? []).every((j) => j.correspondance?.statut === 'NON_CONFIRMEE'
        && j.correspondance.dimensions.join() === 'secteur')).toBe(true);
    }
  });

  it('le programme (filtre que nul marché ne sert aujourd’hui) suit le contrat : une offre qui déclare un CDI le précise, une offre muette va à part', async () => {
    // PRÉMISSE : le filtre `programme` est refusé par le plan sur le marché FR ; le témoin le pose donc directement.
    const plan = planifierRecherche(exigerPerimetre('FR'), { filtres: { maison: maisons, programme: ['APPRENTICESHIP'] }, fraicheur: true, nonPrecisees: true });
    expect(plan.refus.map((r) => r.cle)).toContain('programme');
    const avecProgramme = { ...plan, selections: { ...plan.selections, programme: ['APPRENTICESHIP'] } };
    expect((await searchSummary(avecProgramme, null, 25)).ids).toEqual([]);
    const r = await searchSummary({ ...avecProgramme, section: 'inconnues' }, null, 25);
    // Le CDI, la Maison de mode (CDI) et le CDD déclarent leur contrat : écartés. L'offre muette va à part.
    expect(court(r.ids)).toEqual(['sans-secteur-sans-langue']);
    expect(r.nonPrecisees).toEqual({ [`${P}sans-secteur-sans-langue`]: ['programme'] });
  });
});
