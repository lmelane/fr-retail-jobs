import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { COMPANY_PAGE_SIZE, getCompanies } from '../companies';
import { CurseurInvalideError } from '../curseur';

/**
 * L'ANNUAIRE PAGINE PAR CURSEUR (lot 7) — sur une vraie base : 45 Maisons
 * françaises d'une offre chacune, soit plus qu'une page de 40. Deux pages sans
 * doublon ni oubli, un jeton d'autres critères refusé.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);

const M = 'temoin-annuaire';
const N = COMPANY_PAGE_SIZE + 5;
const nom = (i: number) => `Maison Annuaire ${String(i).padStart(2, '0')}`;

describe.skipIf(!enabled)('annuaire : curseur (lot 7)', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { job: { id: { startsWith: M } } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: M } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: M } } });
  };
  beforeAll(async () => {
    await nettoyer();
    for (let i = 0; i < N; i++) {
      const id = `${M}-${String(i).padStart(2, '0')}`;
      const lien = `https://example.com/${M}/${i}`;
      await prisma.company.create({ data: { id, name: nom(i), canonicalKey: id, fashionjobsUrl: `resolved:${id}` } });
      await prisma.job.create({ data: {
        id: `${M}-offre-${String(i).padStart(2, '0')}`, companyId: id, source: 'GENERIC_JSONLD', externalId: String(i), fingerprint: `${M}-offre-${i}`,
        title: 'Conseiller de vente', url: lien, city: 'Paris', countryCode: 'FR', isFrance: true, language: 'fr', isActive: true,
        postedAt: new Date('2026-09-01'), firstSeenAt: new Date('2026-09-01'),
        sources: { create: { sourceKey: M, sourceTier: 'ATS_OFFICIAL', externalId: String(i), url: lien, isActive: true,
          ...publicationFixture({ sourceKey: M, sourceTier: 'ATS_OFFICIAL', externalId: String(i), url: lien, title: 'Conseiller de vente', city: 'Paris', country: 'FR', language: 'fr', postedAt: new Date('2026-09-01') }) } },
      } });
    }
  }, 120_000);
  afterAll(nettoyer);

  it('PRÉMISSE puis preuve — 45 Maisons dépassent une page : deux pages sans doublon ni oubli, la seconde sans suite', async () => {
    const page1 = await getCompanies({ marche: 'FR', q: 'Maison Annuaire' });
    expect(page1.total).toBe(N);
    expect(page1.companies).toHaveLength(COMPANY_PAGE_SIZE);
    expect(page1.suivant).not.toBeNull();
    const page2 = await getCompanies({ marche: 'FR', q: 'Maison Annuaire', apres: page1.suivant! });
    expect(page2.companies).toHaveLength(N - COMPANY_PAGE_SIZE);
    expect(page2.suivant).toBeNull();
    const noms = [...page1.companies, ...page2.companies].map((c) => c.name);
    expect(new Set(noms).size).toBe(N);
    expect(noms).toEqual(Array.from({ length: N }, (_, i) => nom(i)));
  });

  it('un jeton d’autres critères, ou malformé, est refusé', async () => {
    const page1 = await getCompanies({ marche: 'FR', q: 'Maison Annuaire' });
    await expect(getCompanies({ marche: 'FR', q: 'Maison Annuaire 0', apres: page1.suivant! })).rejects.toBeInstanceOf(CurseurInvalideError);
    await expect(getCompanies({ marche: 'US', q: 'Maison Annuaire', apres: page1.suivant! })).rejects.toBeInstanceOf(CurseurInvalideError);
    await expect(getCompanies({ marche: 'FR', q: 'Maison Annuaire', apres: '???' })).rejects.toBeInstanceOf(CurseurInvalideError);
  });
});
