import { publicationFixture } from '../../../aggregator/src/test/publication-fixture';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@catwalks/db';
import { GET } from '../../app/api/sitemap/emplois/route';
import { offerPath } from '../offer-url';
import { TAILLE_PAGE } from '../sitemap-emplois';

/**
 * LOT 9 — LE SITEMAP DU CATALOGUE NE LISTE QUE LE STOCK ÉLIGIBLE, sur une vraie base.
 *
 * Prémisse par cas : chaque offre non éligible l'est pour UNE raison nommée
 * (candidature spontanée, description trop courte, sans date, source échue,
 * offre directe échue) ; le témoin échoue si l'une d'elles entre dans le sitemap.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);

const M = 'temoin-sitemap';
const MAISON = 'Maison Sitemap Témoin';
const CLE = 'cle-sitemap-temoin';
const LONGUE = 'Description suffisante pour un balisage sérieux. '.repeat(4);

type G = { id: string; titre: string; description?: string; posteLe?: string | null; spontanee?: boolean; echue?: boolean };
const GRAINES: readonly G[] = [
  { id: 'eligible', titre: 'Conseiller de vente — Boutique Rivoli', description: LONGUE, posteLe: '2026-09-01' },
  { id: 'spontanee', titre: 'Candidature spontanée', description: LONGUE, posteLe: '2026-09-02', spontanee: true },
  { id: 'courte', titre: 'Vendeur', description: 'Trop court.', posteLe: '2026-09-03' },
  { id: 'sans-date', titre: 'Assistant merchandising', description: LONGUE, posteLe: null },
  { id: 'echue', titre: 'Stagiaire', description: LONGUE, posteLe: '2026-06-01', echue: true },
];
const requete = (page?: number) => new NextRequest(`http://localhost/api/sitemap/emplois${page ? `?page=${page}` : ''}`, { headers: { authorization: `Bearer ${CLE}` } });

describe.skipIf(!enabled)('sitemap du catalogue (lot 9)', () => {
  const nettoyer = async () => {
    await prisma.jobSource.deleteMany({ where: { job: { id: { startsWith: M } } } });
    await prisma.job.deleteMany({ where: { id: { startsWith: M } } });
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: M } } });
    await prisma.company.deleteMany({ where: { id: { startsWith: M } } });
  };
  beforeAll(async () => {
    process.env.CATALOGUE_API_KEY = CLE;
    await nettoyer();
    await prisma.company.create({ data: { id: `${M}-maison`, name: MAISON, canonicalKey: `${M}-maison`, fashionjobsUrl: `resolved:${M}-maison` } });
    for (const g of GRAINES) {
      const lien = `https://example.com/${M}/${g.id}`;
      const posteLe = g.posteLe ? new Date(g.posteLe) : null;
      await prisma.job.create({ data: {
        id: `${M}-${g.id}`, companyId: `${M}-maison`, source: 'GENERIC_JSONLD', externalId: g.id, title: g.titre, description: g.description ?? null, url: lien, city: 'Paris', countryCode: 'FR', employmentTerm: 'PERMANENT', workTime: 'FULL_TIME', language: 'fr', isActive: true,
        opportunityType: g.spontanee ? 'OPEN_APPLICATION' : 'JOB_OPENING',
        postedAt: posteLe, firstSeenAt: new Date('2026-08-01'),
        sources: { create: { sourceKey: M, sourceTier: 'ATS_OFFICIAL', externalId: g.id, url: lien, isActive: true,
          expiresAt: g.echue ? new Date('2026-07-01') : null,
          ...publicationFixture({ sourceKey: M, sourceTier: 'ATS_OFFICIAL', externalId: g.id, url: lien, title: g.titre, description: g.description, city: 'Paris',
            country: 'FR', employmentTerm: 'PERMANENT', workTime: 'FULL_TIME', language: 'fr', postedAt: posteLe ?? undefined }) } },
      } });
    }
    const directe = (id: string, extra: Record<string, unknown>) => prisma.directOffer.create({ data: {
      id: `${M}-${id}`, version: BigInt(1), appliedSeq: BigInt(1), eligible: true, payloadHash: 'temoin', payload: {}, correspondanceVersion: 1,
      slug: id, title: `Offre directe ${id}`, company: MAISON, countryCode: 'FR', city: 'Paris', location: 'Paris, FR', description: LONGUE,
      applyUrl: `https://catwalks.io/offres/${id}`, postedAt: new Date('2026-09-05'), modifiedAt: new Date('2026-09-05'), searchText: `Offre directe ${id} ${MAISON} Paris`,
      ...extra,
    } });
    await directe('directe-eligible', {});
    await directe('directe-echue', { validThrough: new Date('2026-08-01') });
    await directe('directe-courte', { description: 'Court.' });
  }, 120_000);
  afterAll(nettoyer);

  it('PRÉMISSE — le semis porte une offre éligible par origine, et une inéligible par motif', async () => {
    expect(await prisma.job.count({ where: { id: { startsWith: M } } })).toBe(5);
    expect(await prisma.directOffer.count({ where: { id: { startsWith: M } } })).toBe(3);
  });

  it('sert la page 1 : les seules offres éligibles, offres directes d’abord, chemins du site, lastmod vrai', async () => {
    const reponse = await GET(requete());
    expect(reponse.status).toBe(200);
    const corps = await reponse.json() as { page: number; pages: number; taille: number; total: number; entrees: Array<{ chemin: string; lastmod: string }> };
    expect(corps).toMatchObject({ page: 1, taille: TAILLE_PAGE });
    const temoins = corps.entrees.filter((e) => e.chemin.includes(M));
    expect(temoins.map((e) => e.chemin)).toEqual([
      offerPath({ id: `cw_${M}-directe-eligible`, title: 'Offre directe directe-eligible' }),
      offerPath({ id: `${M}-eligible`, title: 'Conseiller de vente — Boutique Rivoli' }),
    ]);
    expect(temoins[1].chemin).toBe(`/emplois/conseiller-de-vente-boutique-rivoli-${M}-eligible`);
    for (const e of temoins) expect(Number.isNaN(Date.parse(e.lastmod))).toBe(false);
    // Le total compte les mêmes offres que les pages : le nombre de pages en découle.
    expect(corps.pages).toBe(Math.max(1, Math.ceil(corps.total / TAILLE_PAGE)));
    expect(corps.total).toBeGreaterThanOrEqual(2);
    expect(corps.entrees.length).toBeLessThanOrEqual(TAILLE_PAGE);
  });

  it('une page au-delà de la dernière rend 404, jamais un sitemap vide ; sans clé, refus', async () => {
    expect((await GET(requete(9_999))).status).toBe(404);
    expect((await GET(new NextRequest('http://localhost/api/sitemap/emplois'))).status).toBe(401);
  });
});
