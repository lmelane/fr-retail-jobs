import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { examinerAlerte, getJobs, type JobFilters } from '../jobs';
import { drainSearchIndex, initializeSearchIndex } from '../search-index';

/**
 * R-143 §8 (D-513, lecture D-492 du 02/10/2026) — UNE ALERTE EST UNE PROMESSE : chaque offre notifiée respecte TOUS les
 * critères de l'alerte. Une offre conforme, puis une offre par critère qui ne le respecte que pour celui-là : l'examen ne
 * doit rendre que la conforme. Si un critère était ignoré, son offre fautive partirait et ce témoin rougirait (éprouvé en
 * retirant chaque prédicat, `audits/2026-10-02/r143-filtres-alertes/`). Le rayon est éprouvé par `proximite-d496.test.ts`.
 *
 * L'alerte : « Visual Merchandiser · Paris · CDI · temps plein », Maison, groupe et langue de l'annonce. Le secteur passe par
 * le même prédicat (`restriction`), éprouvé sur une Maison revue par `fraicheur-d510.test.ts` (une appartenance sectorielle
 * exige un manifeste de revue).
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const P = 'r143-alerte-';
const M1 = `${P}maison`, M2 = `${P}autre-maison`, M4 = `${P}autre-groupe`;
const GROUPE = 'Groupe Alerte R143', AUTRE_GROUPE = 'Autre Groupe R143';

type Offre = { id: string; titre?: string; code?: string; ville?: string; terme?: string | null; temps?: string | null; maison?: string; langue?: string };
const CONFORME: Required<Offre> = { id: 'conforme', titre: 'Visual Merchandiser', code: 'visual-merchandiser', ville: 'Paris', terme: 'PERMANENT', temps: 'FULL_TIME', maison: M1, langue: 'fr' };
/** Une offre fautive par critère : le critère qu'elle viole est son identifiant. */
const FAUTIVES: Offre[] = [
  { id: 'metier', code: 'sales-advisor', titre: 'Visual Merchandiser Conseiller' },
  { id: 'ville', ville: 'Lyon' },
  { id: 'contrat-cdd', terme: 'FIXED_TERM' },
  { id: 'contrat-non-precise', terme: null },
  { id: 'temps', temps: 'PART_TIME' },
  { id: 'temps-non-precise', temps: null },
  // La Maison fautive est du bon groupe ; la Maison du mauvais groupe est retenue par le critère « Maison » : chacune
  // n'est écartée que par son critère.
  { id: 'maison', maison: M2 },
  { id: 'groupe', maison: M4 },
  { id: 'langue', langue: 'en' },
  { id: 'mot-cle', titre: 'Responsable de boutique', code: 'sales-advisor' },
];
const FILIGRANE = new Date('2026-09-29T00:00:00Z');
const BORNE = new Date('2026-09-01T00:00:00Z');

describe.skipIf(!enabled)('R-143 §8 — l’examen d’une alerte tient chacun de ses critères', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: P } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: P } } });
    await initializeSearchIndex();
    while (await drainSearchIndex()) { /* index à jour */ }
  };
  beforeAll(async () => {
    await nettoyer();
    for (const [id, groupe] of [[M1, GROUPE], [M2, GROUPE], [M4, AUTRE_GROUPE]]) {
      await prisma.company.create({ data: { id, name: id, canonicalKey: id, fashionjobsUrl: `resolved:${id}`, sector: 'LUXURY', parentGroup: groupe } });
    }
    let h = 0;
    for (const f of [CONFORME, ...FAUTIVES]) {
      const o = { ...CONFORME, ...f };
      const id = `${P}${o.id}`;
      const lien = `https://example.com/${id}`;
      const entree = new Date(Date.UTC(2026, 8, 29, 1 + h++));
      await prisma.job.create({ data: {
        id, companyId: o.maison, source: 'GENERIC_JSONLD', externalId: id, title: o.titre, url: lien, countryCode: 'FR', city: o.ville,
        isActive: true, postedAt: entree, firstSeenAt: entree, titleRoles: [o.code], titleRolesReleaseId: 'catwalks-occupations-20260929-v3', employmentTerm: o.terme, workTime: o.temps, language: o.langue,
        sources: { create: { sourceKey: 'r143-alerte', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, isActive: true,
          ...publicationFixture({ sourceKey: 'r143-alerte', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, title: o.titre, country: 'FR' }) } },
      } });
    }
    while (await drainSearchIndex()) { /* index à jour */ }
  }, 120_000);
  afterAll(nettoyer);

  const alerte = (filtres: JobFilters['filtres'], q?: string): JobFilters => ({ marche: 'FR', lieu: 'Paris', q, fraicheur: true, comprendre: true, nonPrecisees: true,
    filtres: { metier: ['visual-merchandiser'], contrat: ['PERMANENT'], temps: ['FULL_TIME'], maison: [M1, M4], groupe: [GROUPE], langue: ['fr'], ...filtres } });

  it('PRÉMISSE : sans ses critères, la recherche rend la conforme ET chacune des fautives', async () => {
    const r = await getJobs({ marche: 'FR', filtres: { maison: [M1, M2, M4] } });
    expect(r.total).toBe(1 + FAUTIVES.length);
  });

  it('l’alerte par métier n’envoie que l’offre qui respecte chaque critère', async () => {
    const ex = await examinerAlerte(alerte({}), FILIGRANE, BORNE);
    expect(ex.jobs.map((j) => j.id)).toEqual([`${P}conforme`]);
    expect(ex.total).toBe(1);
  });

  it('l’alerte par mot-clé, de même (le mot-clé remplace le métier : une requête, pas deux)', async () => {
    const { metier: _m, ...sansMetier } = alerte({}).filtres;
    const ex = await examinerAlerte({ ...alerte({}, 'visual merchandiser'), filtres: sansMetier }, FILIGRANE, BORNE);
    // La requête comprise (D-500) lit le métier « visual merchandiser » : l'offre « Visual Merchandiser Conseiller »,
    // classée conseil de vente, n'y répond pas ; « Responsable de boutique » non plus. Aucune fautive ne part.
    expect(ex.jobs.map((j) => j.id)).toEqual([`${P}conforme`]);
  });

  it('la page, elle, montre aussi les offres qui ne précisent pas le contrat ou le temps de travail, signalées', async () => {
    const page = await getJobs(alerte({}));
    expect(page.jobs.map((j) => j.id)).toEqual([`${P}conforme`, `${P}temps-non-precise`, `${P}contrat-non-precise`]);
    expect(page.totalConfirmes).toBe(1);
  });
});
