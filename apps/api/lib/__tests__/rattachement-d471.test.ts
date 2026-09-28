import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';
import { directToRow } from '../direct-offers';
import { getCompanyAside, getSimilarJobs } from '../jobs';

/**
 * D-471 — LE BLOC MAISON ET « MÊME EMPLOYEUR » SUIVENT LA SOCIÉTÉ RATTACHÉE, PAS LE NOM PUBLIÉ.
 *
 * Le backend publie « Lancel » ; le registre connaît « LANCEL ». Le lecteur rattache l'offre Catwalks à la société
 * (lien du back-office ou nom sans casse ni accents). La fiche doit compter les offres de cette société et proposer
 * ses offres comme « même employeur » : comparer le nom publié à l'identique ne trouvait rien (audit du 27/09/2026).
 * Base jetable seulement.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const R = 'temoinrattache';
const SOCIETE = `${R}lancel`;

describe.skipIf(!enabled)('le rattachement de D-471 sur la fiche (base réelle)', () => {
  const nettoyer = async () => {
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: R } } });
    await prisma.jobSource.deleteMany({ where: { job: { id: { startsWith: R } } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: R } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: R } } });
  };
  const directe = (id: string, surcharge: Record<string, unknown> = {}) => ({
    id: `${R}${id}`, version: BigInt(1), appliedSeq: BigInt(1), eligible: true, payloadHash: 'temoin', payload: {}, correspondanceVersion: 6,
    slug: `${R}-${id}`, title: 'Directeur de boutique', company: 'Lancel Témoin', companyId: SOCIETE, countryCode: 'FR', city: 'Lyon',
    location: 'Lyon', sectorCodes: ['LEATHER_GOODS'], description: 'Au sein de la boutique.', applyUrl: `https://catwalks.io/offres/${R}-${id}`,
    postedAt: new Date('2026-09-21'), modifiedAt: new Date('2026-09-21'), ...surcharge,
  });

  beforeAll(async () => {
    await nettoyer();
    await prisma.company.create({ data: { id: SOCIETE, name: 'LANCEL TÉMOIN', canonicalKey: SOCIETE, fashionjobsUrl: `resolved:${SOCIETE}`, domain: 'lancel.com' } });
    for (let i = 0; i < 2; i++) {
      const lien = `https://example.com/${R}/${i}`;
      await prisma.job.create({ data: {
        id: `${R}offre${i}`, companyId: SOCIETE, source: 'GENERIC_JSONLD', externalId: `${R}-${i}`, title: 'Conseiller de vente', url: lien,
        city: 'Lyon', countryCode: 'FR', language: 'fr', isActive: true, postedAt: new Date('2026-09-01'), firstSeenAt: new Date('2026-09-01'),
        sources: { create: { sourceKey: R, sourceTier: 'ATS_OFFICIAL', externalId: `${R}-${i}`, url: lien, isActive: true,
          ...publicationFixture({ sourceKey: R, sourceTier: 'ATS_OFFICIAL', externalId: `${R}-${i}`, url: lien, title: 'Conseiller de vente', city: 'Lyon', country: 'FR', language: 'fr', postedAt: new Date('2026-09-01') }) } },
      } });
    }
    await prisma.directOffer.create({ data: directe('a') as never });
  }, 120_000);
  afterAll(nettoyer);

  it('le bloc Maison compte les offres de la société rattachée et l’offre Catwalks, malgré un nom publié différent', async () => {
    // PRÉMISSE : par le seul nom publié, la société n'est pas trouvée (casse et accent diffèrent).
    expect(await prisma.company.findFirst({ where: { name: 'Lancel Témoin' } })).toBeNull();
    const bloc = await getCompanyAside('Lancel Témoin', SOCIETE);
    expect(bloc).toMatchObject({ openJobs: 3, domain: 'lancel.com' });
    // Sans la société, seul le nom publié compte : l'offre Catwalks seule, sans domaine.
    expect(await getCompanyAside('Lancel Témoin')).toMatchObject({ openJobs: 1, domain: null });
  });

  it('« même employeur » propose les offres de la société rattachée', async () => {
    const offre = directToRow((await prisma.directOffer.findUniqueOrThrow({ where: { id: `${R}a` } })));
    expect(offre.companyId).toBe(SOCIETE);
    const similaires = await getSimilarJobs(offre, 6, 'fr');
    const ids = similaires.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([`${R}offre0`, `${R}offre1`]));
    // Le bloc « même employeur » vient avant le remplissage : les deux offres de la société ouvrent la liste.
    expect(ids.slice(0, 2).sort()).toEqual([`${R}offre0`, `${R}offre1`]);
  });

  it('une offre agrégée de la société compte aussi les offres Catwalks qui lui sont rattachées', async () => {
    const bloc = await getCompanyAside('LANCEL TÉMOIN', SOCIETE);
    expect(bloc?.openJobs).toBe(3);
  });
});
