import { describe, expect, it } from 'vitest';
import { prisma } from '@catwalks/db';

/**
 * D-496 — LE POINT D'UNE OFFRE NE FAIT JAMAIS ÉCHOUER SON ÉCRITURE.
 *
 * Les déclencheurs `catwalks_geo_job` et `catwalks_geo_offre_directe` calculent le point de chaque offre écrite. Si ce
 * calcul lève (lieu inattendu, clé, `unaccent`, conversion, verrou…), l'INSERT ou l'UPDATE de l'offre doit réussir
 * quand même, point vide : sinon l'ingestion du RUN et la synchronisation directe échouent avec lui.
 *
 * Le témoin remplace, DANS une transaction annulée à la fin, la fonction du calcul (`catwalks_point_offre`) par une
 * fonction qui lève : rien ne survit au témoin. Prémisse : sans la panne, les mêmes écritures reçoivent un point (natif).
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);
const P = 'garde-geo-d496-';

class Annuler extends Error {}

/** Exécute `corps` dans une transaction toujours annulée ; rend ce que `corps` a mesuré. */
async function dansUneTransactionAnnulee<T>(corps: (tx: typeof prisma) => Promise<T>): Promise<T> {
  let resultat: T | undefined;
  await prisma.$transaction(async (tx) => {
    resultat = await corps(tx as unknown as typeof prisma);
    throw new Annuler();
  }, { timeout: 30_000 }).catch((e: unknown) => { if (!(e instanceof Annuler)) throw e; });
  return resultat as T;
}

/** Une offre agrégée et une offre directe, écrites puis déplacées (UPDATE de la ville et des coordonnées). */
async function ecrire(tx: typeof prisma) {
  await tx.company.create({ data: { id: `${P}maison`, name: `${P}maison`, canonicalKey: `${P}maison`, fashionjobsUrl: `resolved:${P}maison` } });
  await tx.job.create({ data: { id: `${P}job`, companyId: `${P}maison`, externalId: `${P}job`, source: 'GENERIC_JSONLD', title: 'Conseiller de vente',
    url: `https://example.com/${P}job`, isActive: true, countryCode: 'FR', city: 'Paris', latitude: 48.8566, longitude: 2.3522 } });
  await tx.directOffer.create({ data: {
    id: `${P}directe`, version: BigInt(1), appliedSeq: BigInt(1), eligible: true, payloadHash: 'temoin', payload: {},
    correspondanceVersion: 1, slug: `${P}directe`, title: 'Conseiller de vente', company: `${P}maison`, companyId: `${P}maison`,
    countryCode: 'FR', city: 'Paris', location: 'Paris', language: 'fr', description: 'Conseiller de vente', latitude: 48.8566, longitude: 2.3522,
    applyUrl: `https://catwalks.io/offres/${P}directe`, postedAt: new Date('2026-09-01T00:00:00Z'), modifiedAt: new Date('2026-09-01T00:00:00Z'),
    searchText: 'Conseiller de vente' } });
  const apresInsertion = {
    job: await tx.job.findUniqueOrThrow({ where: { id: `${P}job` }, select: { geoSource: true, geoLatitude: true } }),
    directe: await tx.directOffer.findUniqueOrThrow({ where: { id: `${P}directe` }, select: { geoSource: true, geoLatitude: true } }),
  };
  await tx.job.update({ where: { id: `${P}job` }, data: { city: 'Lyon', latitude: 45.764, longitude: 4.8357 } });
  await tx.directOffer.update({ where: { id: `${P}directe` }, data: { city: 'Lyon', latitude: 45.764, longitude: 4.8357 } });
  const apresMiseAJour = {
    job: await tx.job.findUniqueOrThrow({ where: { id: `${P}job` }, select: { city: true, geoSource: true, geoLatitude: true } }),
    directe: await tx.directOffer.findUniqueOrThrow({ where: { id: `${P}directe` }, select: { city: true, geoSource: true, geoLatitude: true } }),
  };
  return { apresInsertion, apresMiseAJour };
}

describe.skipIf(!enabled)('le garde des déclencheurs du point (D-496)', () => {
  it('PRÉMISSE : sans panne, l’offre agrégée et l’offre directe reçoivent leur point', async () => {
    const r = await dansUneTransactionAnnulee(ecrire);
    expect(r.apresInsertion).toEqual({ job: { geoSource: 'NATIVE', geoLatitude: 48.8566 }, directe: { geoSource: 'NATIVE', geoLatitude: 48.8566 } });
    expect(r.apresMiseAJour.job).toEqual({ city: 'Lyon', geoSource: 'NATIVE', geoLatitude: 45.764 });
  });

  it('le calcul du point lève : l’INSERT et l’UPDATE réussissent quand même, point vide', async () => {
    const r = await dansUneTransactionAnnulee(async (tx) => {
      // La panne : la fonction du calcul lève à chaque appel (annulée avec la transaction).
      await tx.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION catwalks_point_offre(pays TEXT, ville TEXT, indice TEXT,
        lat DOUBLE PRECISION, lon DOUBLE PRECISION, OUT "cityId" INTEGER, OUT "latitude" DOUBLE PRECISION,
        OUT "longitude" DOUBLE PRECISION, OUT "source" TEXT) LANGUAGE plpgsql STABLE AS $$
        BEGIN RAISE EXCEPTION 'témoin : le calcul du point échoue' USING ERRCODE = 'XX000'; END $$`);
      return ecrire(tx);
    });
    expect(r.apresInsertion).toEqual({ job: { geoSource: null, geoLatitude: null }, directe: { geoSource: null, geoLatitude: null } });
    // La mise à jour de l'offre est écrite (la ville change), et son point est vidé plutôt que laissé périmé.
    expect(r.apresMiseAJour).toEqual({ job: { city: 'Lyon', geoSource: null, geoLatitude: null }, directe: { city: 'Lyon', geoSource: null, geoLatitude: null } });
  });

  it('la panne n’a pas survécu au témoin : la fonction du calcul est intacte', async () => {
    const [{ src }] = await prisma.$queryRaw<{ src: string }[]>`SELECT prosrc AS src FROM pg_proc WHERE proname = 'catwalks_point_offre'`;
    expect(src).not.toContain('témoin');
  });
});
