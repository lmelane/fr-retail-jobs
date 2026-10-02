import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { examinerAlerte, type JobFilters } from '../jobs';
import { drainSearchIndex, initializeSearchIndex } from '../search-index';

/**
 * D-515 §2 (lecture D-492 du 02/10/2026) — UNE ALERTE ENVOIE LE CERTAIN D'ABORD, PUIS L'INCOMPLET À PART.
 *
 * L'examen rend les offres qui respectent avec certitude TOUS les critères (`jobs`) et, séparément, celles qui respectent
 * avec certitude tous les autres critères (métier, lieu, Maison…) mais ne précisent pas le contrat ou le temps de travail
 * filtré (`jobsIncompletes`, signalées avec leurs dimensions). Une offre qui DÉCLARE une valeur contraire (un CDD, un
 * stage, un temps partiel) n'apparaît jamais, ni dans l'une ni dans l'autre. Le lieu et le métier restent stricts (R-141).
 *
 * PRÉMISSE : les offres incomplètes sont PLUS FRAÎCHES que les certaines ; mêlées par fraîcheur, elles passeraient devant.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const P = 'd515-alertes-';
const MAISON = `${P}maison`;

type Cas = { id: string; employmentTerm?: string; programType?: string; workTime?: string; heure: number; ville?: string; titre?: string };
const CAS: Cas[] = [
  { id: 'cdi', employmentTerm: 'PERMANENT', workTime: 'FULL_TIME', heure: 1 },
  { id: 'cdi-partiel', employmentTerm: 'PERMANENT', workTime: 'PART_TIME', heure: 2 },
  { id: 'cdd', employmentTerm: 'FIXED_TERM', workTime: 'FULL_TIME', heure: 20 },
  { id: 'stage', programType: 'INTERNSHIP', heure: 21 },
  { id: 'rien', heure: 22 },
  { id: 'temps-partiel-seul', workTime: 'PART_TIME', heure: 23 },
  // Hors des autres critères : une autre ville, un autre métier. Sans contrat, ils ne partent JAMAIS en section 2.
  { id: 'rien-lyon', heure: 24, ville: 'Lyon' },
  { id: 'rien-comptable', heure: 25, titre: 'Comptable fournisseurs' },
];
const FILIGRANE = new Date('2026-09-29T00:00:00Z');
const BORNE_PUBLICATION = new Date('2026-09-01T00:00:00Z');

describe.skipIf(!enabled)('D-515 §2 — l’examen d’une alerte : certaines, puis incomplètes', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: P } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: P } } });
    await initializeSearchIndex();
    while (await drainSearchIndex()) { /* index à jour */ }
  };
  beforeAll(async () => {
    await nettoyer();
    await prisma.company.create({ data: { id: MAISON, name: MAISON, canonicalKey: MAISON, fashionjobsUrl: `resolved:${MAISON}`, sector: 'LUXURY' } });
    for (const c of CAS) {
      const id = `${P}${c.id}`;
      const lien = `https://example.com/${id}`;
      const entree = new Date(Date.UTC(2026, 8, 29, c.heure));
      const titre = c.titre ?? 'Conseiller de vente';
      await prisma.job.create({ data: {
        id, companyId: MAISON, source: 'GENERIC_JSONLD', externalId: id, title: titre, url: lien, countryCode: 'FR',
        city: c.ville ?? 'Paris', isActive: true, postedAt: entree, firstSeenAt: entree,
        employmentTerm: c.employmentTerm ?? null, programType: c.programType ?? null, workTime: c.workTime ?? null,
        sources: { create: { sourceKey: 'd515', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, isActive: true,
          ...publicationFixture({ sourceKey: 'd515', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, title: titre, country: 'FR' }) } },
      } });
    }
    while (await drainSearchIndex()) { /* index à jour */ }
  }, 120_000);
  afterAll(nettoyer);

  /** Les critères d'une alerte enregistrée depuis le site : Maison, métier tapé, lieu, filtres d'emploi. */
  const alerte = (filtres: JobFilters['filtres'], extra: Partial<JobFilters> = {}): JobFilters =>
    ({ marche: 'FR', q: 'Conseiller de vente', lieu: 'Paris', fraicheur: true, comprendre: true, nonPrecisees: true, ...extra,
      filtres: { maison: [MAISON], ...filtres } });
  const court = (ids: { id: string }[]) => ids.map((j) => j.id.slice(P.length));

  it('PRÉMISSE : les incomplètes sont plus fraîches que les certaines, et les hors-critères existent bien sans contrat', () => {
    const c = (id: string) => CAS.find((x) => x.id === id)!;
    expect(c('rien').heure).toBeGreaterThan(c('cdi-partiel').heure);
    expect(c('rien-lyon').employmentTerm).toBeUndefined();
    expect(c('rien-comptable').employmentTerm).toBeUndefined();
  });

  it('« CDI » : les CDI reconnus en section 1 ; les offres sans contrat du même métier et du même lieu en section 2', async () => {
    const e = await examinerAlerte(alerte({ contrat: ['PERMANENT'] }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(e.jobs).sort()).toEqual(['cdi', 'cdi-partiel']);
    expect(e.nouvelles).toBe(2);
    expect(e.total).toBe(2);
    expect(court(e.jobsIncompletes!)).toEqual(['temps-partiel-seul', 'rien']);
    expect(e.incompletes).toBe(2);
    expect(e.jobsIncompletes!.map((j) => j.correspondance)).toEqual([
      { statut: 'NON_CONFIRMEE', dimensions: ['contrat'] }, { statut: 'NON_CONFIRMEE', dimensions: ['contrat'] }]);
  });

  it('une valeur connue et contraire n’apparaît jamais, une autre ville ou un autre métier non plus', async () => {
    const e = await examinerAlerte(alerte({ contrat: ['PERMANENT'] }), FILIGRANE, BORNE_PUBLICATION);
    const tous = [...court(e.jobs), ...court(e.jobsIncompletes!)];
    for (const exclu of ['cdd', 'stage', 'rien-lyon', 'rien-comptable']) expect(tous, exclu).not.toContain(exclu);
  });

  it('« CDI · temps plein » : le temps partiel déclaré est écarté ; l’offre muette sur les deux nomme les deux', async () => {
    const e = await examinerAlerte(alerte({ contrat: ['PERMANENT'], temps: ['FULL_TIME'] }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(e.jobs)).toEqual(['cdi']);
    expect(court(e.jobsIncompletes!)).toEqual(['rien']);
    expect(e.jobsIncompletes![0].correspondance).toEqual({ statut: 'NON_CONFIRMEE', dimensions: ['contrat', 'temps'] });
  });

  it('« CDD » : une offre « CDI » n’est jamais une incomplète d’une alerte « CDD »', async () => {
    const e = await examinerAlerte(alerte({ contrat: ['FIXED_TERM'] }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(e.jobs)).toEqual(['cdd']);
    expect(court(e.jobsIncompletes!)).toEqual(['temps-partiel-seul', 'rien']);
  });

  it('sans filtre d’emploi, il n’y a rien d’incomplet : tout est certain', async () => {
    const e = await examinerAlerte(alerte({}), FILIGRANE, BORNE_PUBLICATION);
    expect(e.incompletes).toBe(0);
    expect(e.jobsIncompletes).toEqual([]);
    expect(court(e.jobs)).toContain('rien');
  });

  it('contrat 1 (sans en-tête) : le filtre strict d’avant, aucune incomplète', async () => {
    const e = await examinerAlerte(alerte({ contrat: ['PERMANENT'] }, { nonPrecisees: undefined }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(e.jobs).sort()).toEqual(['cdi', 'cdi-partiel']);
    // Le document d'avant, au champ près : ni compte ni liste d'incomplètes (témoins différentiels D-496, D-500).
    expect('incompletes' in e).toBe(false);
    expect('jobsIncompletes' in e).toBe(false);
  });

  it('le filigrane vaut pour les deux sections : rien d’ancien ne revient en section 2', async () => {
    const e = await examinerAlerte(alerte({ contrat: ['PERMANENT'] }), new Date(Date.UTC(2026, 8, 29, 22, 30)), BORNE_PUBLICATION);
    expect(court(e.jobs)).toEqual([]);
    expect(court(e.jobsIncompletes!)).toEqual(['temps-partiel-seul']);
  });
});
