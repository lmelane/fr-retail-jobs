import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { CurseurInvalideError, encoderCurseur } from '../curseur';
import { examinerAlerte, getJobs, type JobFilters } from '../jobs';
import { drainSearchIndex, initializeSearchIndex } from '../search-index';

/**
 * R-143 §6 et §8 (D-513, lecture D-492 du 02/10/2026) — UN FILTRE NE CACHE PAS CE QU'IL NE RECONNAÎT PAS ; UNE ALERTE
 * N'ENVOIE QUE CE QUI RESPECTE SES CRITÈRES.
 *
 * Au contrat 2 (`nonPrecisees`, posé par la route avec `x-catwalks-client: 2`), un filtre « CDI » sert d'abord les CDI
 * reconnus, puis les offres qui ne disent rien de leur contrat, signalées ; un CDD, un stage restent écartés. L'examen
 * d'une alerte « CDI » n'envoie que les CDI reconnus, dans le cercle de la recherche stricte. Sans l'en-tête (contrat 1),
 * le filtre strict d'avant, à l'identique.
 *
 * PRÉMISSE de chaque témoin : les offres non précisées sont PLUS FRAÎCHES que les reconnues. Rangées par fraîcheur seule
 * (l'ordre de D-510 sans la clé `nc`), elles passeraient devant : le témoin d'ordre échoue si la clé perd `nc`.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const P = 'r143-filtres-';
const MAISON = `${P}maison`;

type Cas = { id: string; employmentTerm?: string; programType?: string; workTime?: string; heure: number };
/** `heure` : l'heure d'entrée au catalogue le 29/09 ; plus grande = plus fraîche. */
const CAS: Cas[] = [
  { id: 'cdi', employmentTerm: 'PERMANENT', workTime: 'FULL_TIME', heure: 1 },
  { id: 'cdi-partiel', employmentTerm: 'PERMANENT', workTime: 'PART_TIME', heure: 2 },
  { id: 'cdd', employmentTerm: 'FIXED_TERM', workTime: 'FULL_TIME', heure: 20 },
  { id: 'stage', programType: 'INTERNSHIP', heure: 21 },
  { id: 'rien', heure: 22 },
  { id: 'temps-partiel-seul', workTime: 'PART_TIME', heure: 23 },
];
const FILIGRANE = new Date('2026-09-29T00:00:00Z');
const BORNE_PUBLICATION = new Date('2026-09-01T00:00:00Z');

describe.skipIf(!enabled)('R-143 §6, §8 — filtres d’emploi au contrat 2 et alertes', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: P } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: P } } });
    await initializeSearchIndex();
    while (await drainSearchIndex()) { /* index à jour */ }
  };
  const creer = async (c: Cas & { prefixe?: string }) => {
    const id = `${c.prefixe ?? P}${c.id}`;
    const lien = `https://example.com/${id}`;
    const entree = new Date(Date.UTC(2026, 8, 29, c.heure));
    const { id: _id, heure: _heure, ...faits } = c;
    await prisma.job.create({ data: {
      id, companyId: MAISON, source: 'GENERIC_JSONLD', externalId: id, title: 'Conseiller de vente', url: lien, countryCode: 'FR',
      city: 'Paris', isActive: true, postedAt: entree, firstSeenAt: entree,
      employmentTerm: faits.employmentTerm ?? null, programType: faits.programType ?? null, workTime: faits.workTime ?? null,
      sources: { create: { sourceKey: 'r143', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, isActive: true,
        ...publicationFixture({ sourceKey: 'r143', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, title: 'Conseiller de vente', country: 'FR' }) } },
    } });
  };
  beforeAll(async () => {
    await nettoyer();
    await prisma.company.create({ data: { id: MAISON, name: MAISON, canonicalKey: MAISON, fashionjobsUrl: `resolved:${MAISON}`, sector: 'LUXURY' } });
    for (const c of CAS) await creer(c);
    while (await drainSearchIndex()) { /* index à jour */ }
  }, 120_000);
  afterAll(nettoyer);

  const contrat2 = (filtres: JobFilters['filtres'], extra: Partial<JobFilters> = {}): JobFilters =>
    ({ marche: 'FR', fraicheur: true, comprendre: true, nonPrecisees: true, ...extra, filtres: { maison: [MAISON], ...filtres } });
  const contrat1 = (filtres: JobFilters['filtres']): JobFilters => ({ marche: 'FR', filtres: { maison: [MAISON], ...filtres } });
  const court = (ids: string[]) => ids.map((id) => id.slice(P.length));

  it('PRÉMISSE : les offres non précisées sont plus fraîches que les CDI reconnus', () => {
    const heure = (id: string) => CAS.find((c) => c.id === id)!.heure;
    expect(Math.min(heure('rien'), heure('temps-partiel-seul'))).toBeGreaterThan(Math.max(heure('cdi'), heure('cdi-partiel')));
  });

  it('contrat 1 (sans en-tête) : le filtre strict d’avant, à l’identique', async () => {
    const r = await getJobs(contrat1({ contrat: ['PERMANENT'] }));
    expect(court(r.jobs.map((j) => j.id)).sort()).toEqual(['cdi', 'cdi-partiel']);
    expect(r.total).toBe(2);
    expect(r.totalConfirmes).toBe(2);
    expect(r.jobs.every((j) => j.correspondance?.statut === 'CONFIRMEE')).toBe(true);
  });

  it('« CDI » au contrat 2 : les CDI reconnus d’abord, puis les offres sans contrat, signalées ; CDD et stage écartés', async () => {
    const r = await getJobs(contrat2({ contrat: ['PERMANENT'] }));
    expect(court(r.jobs.map((j) => j.id))).toEqual(['cdi-partiel', 'cdi', 'temps-partiel-seul', 'rien']);
    expect(r.total).toBe(4);
    expect(r.totalConfirmes).toBe(2);
    expect(r.jobs.map((j) => j.correspondance)).toEqual([
      { statut: 'CONFIRMEE' }, { statut: 'CONFIRMEE' },
      { statut: 'NON_CONFIRMEE', dimensions: ['contrat'] }, { statut: 'NON_CONFIRMEE', dimensions: ['contrat'] },
    ]);
  });

  it('« CDI · temps plein » : une incompatibilité connue écarte, une absence garde, et la carte nomme ce qui manque', async () => {
    const r = await getJobs(contrat2({ contrat: ['PERMANENT'], temps: ['FULL_TIME'] }));
    // cdi-partiel (temps partiel déclaré) et temps-partiel-seul sont écartés ; « rien » ne précise ni l'un ni l'autre.
    expect(court(r.jobs.map((j) => j.id))).toEqual(['cdi', 'rien']);
    expect(r.jobs[1].correspondance).toEqual({ statut: 'NON_CONFIRMEE', dimensions: ['contrat', 'temps'] });
    expect(r.totalConfirmes).toBe(1);
  });

  it('un curseur de la clé à trois termes (D-510, avant D-513) est refusé', async () => {
    const r = await getJobs(contrat2({ contrat: ['PERMANENT'] }));
    expect(r.suivant).toBeNull();
    // Un jeton bien formé, d'une empreinte quelconque et de l'ancienne arité : refusé (forme ou critères), jamais repris.
    await expect(getJobs(contrat2({ contrat: ['PERMANENT'] }, { apres: encoderCurseur('x', [0, -1, 'id']) })))
      .rejects.toBeInstanceOf(CurseurInvalideError);
  });

  it('l’alerte « CDI » n’envoie que les CDI reconnus, et son total est le leur', async () => {
    const examen = await examinerAlerte(contrat2({ contrat: ['PERMANENT'] }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(examen.jobs.map((j) => j.id)).sort()).toEqual(['cdi', 'cdi-partiel']);
    expect(examen.nouvelles).toBe(2);
    expect(examen.total).toBe(2);
  });

  it('l’alerte « CDI · temps plein » n’envoie que l’offre qui respecte les deux critères', async () => {
    const examen = await examinerAlerte(contrat2({ contrat: ['PERMANENT'], temps: ['FULL_TIME'] }), FILIGRANE, BORNE_PUBLICATION);
    expect(court(examen.jobs.map((j) => j.id))).toEqual(['cdi']);
    expect(examen.total).toBe(1);
  });

  it('sans filtre d’emploi, rien ne change : tout est confirmé', async () => {
    const r = await getJobs(contrat2({}));
    expect(r.total).toBe(CAS.length);
    expect(r.totalConfirmes).toBe(CAS.length);
    expect(r.jobs.every((j) => j.correspondance?.statut === 'CONFIRMEE')).toBe(true);
  });

  describe('la pagination à la frontière des reconnues et des non précisées', () => {
    const PP = `${P}page-`;
    beforeAll(async () => {
      // 26 offres sans contrat, plus fraîches que les deux CDI : 28 offres, deux pages de 25.
      for (let i = 0; i < 26; i++) await creer({ id: String(i).padStart(2, '0'), heure: 30 + i, prefixe: PP });
      while (await drainSearchIndex()) { /* index à jour */ }
    }, 120_000);

    it('aucun doublon, aucun trou, et toutes les reconnues avant toutes les non précisées', async () => {
      const ids: string[] = [];
      const statuts: string[] = [];
      let apres: string | undefined;
      let pages = 0;
      do {
        const r = await getJobs({ ...contrat2({ contrat: ['PERMANENT'] }), apres });
        ids.push(...r.jobs.map((j) => j.id));
        statuts.push(...r.jobs.map((j) => j.correspondance!.statut));
        apres = r.suivant ?? undefined;
        pages++;
      } while (apres && pages < 5);
      expect(pages).toBe(2);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBe(2 + 2 + 26);
      expect(statuts.slice(0, 2)).toEqual(['CONFIRMEE', 'CONFIRMEE']);
      expect(statuts.slice(2).every((s) => s === 'NON_CONFIRMEE')).toBe(true);
    });
  });
});
