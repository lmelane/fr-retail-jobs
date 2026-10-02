import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import '../test/setup-integration.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { applyRattrapagePays, empreinteRattrapage, previewRattrapagePays } from '../geo/rattrapagePays.js';

/**
 * D-520, offres sans pays (02/10/2026) — la preuve de pays sur une vraie base, par la vraie ingestion (`upsertDeduplicated`)
 * et le rattrapage du stock, avec les déclencheurs de proximité (D-496) et d'indexation.
 *
 * Prémisse mesurée en production : 3 217 offres servies sans pays, dont 1 973 Boots (ville et point natif britanniques,
 * aucun champ pays), ce que l'ancienne écriture laissait à `null` — ces témoins passent au rouge sur la version d'avant.
 * Les villes semées sont des extraits GeoNames (noms, pays, subdivisions, centres arrondis) sous des identifiants témoins.
 */
const db = new PrismaClient();
const RELEASE = 4970001;
type Ville = { id: number; name: string; pays: string; a1: string | null; a1nom: string | null; lat: number; lon: number };
const VILLES: Ville[] = [
  { id: 97000001, name: 'Aberdeen', pays: 'GB', a1: 'SCT', a1nom: 'Scotland', lat: 57.14369, lon: -2.09814 },
  { id: 97000002, name: 'Aberdeen', pays: 'US', a1: 'WA', a1nom: 'Washington', lat: 46.97537, lon: -123.81572 },
  { id: 97000003, name: 'Aberdeen', pays: 'AU', a1: '02', a1nom: 'New South Wales', lat: -32.16, lon: 150.89 },
  { id: 97000004, name: 'Morteau', pays: 'FR', a1: '27', a1nom: 'Bourgogne-Franche-Comte', lat: 47.0575, lon: 6.6067 },
  { id: 97000005, name: 'Vanves', pays: 'FR', a1: '11', a1nom: 'Île-de-France', lat: 48.8215, lon: 2.2897 },
  { id: 97000006, name: 'Mans', pays: 'TR', a1: '01', a1nom: 'Adana', lat: 37.0, lon: 35.3 },
  { id: 97000007, name: 'Atlanta', pays: 'US', a1: 'GA', a1nom: 'Georgia', lat: 33.749, lon: -84.38798 },
];

async function semer() {
  await vider();
  await db.$executeRaw`INSERT INTO "GeoCityRelease" ("id", "source", "licence", "attribution", "files", "cities", "names", "labels")
    VALUES (${RELEASE}, 'témoin D-520', 'CC BY 4.0', 'GeoNames', '{}'::jsonb, ${VILLES.length}, 0, 0)`;
  for (const v of VILLES) {
    await db.$executeRaw`INSERT INTO "GeoCity" ("id", "name", "countryCode", "admin1Code", "admin1Name", "subdivision", "subdivisionKeys",
      "latitude", "longitude", "population", "featureCode", "suggestible", "releaseId")
      VALUES (${v.id}, ${v.name}, ${v.pays}, ${v.a1}, ${v.a1nom}, ${v.a1}, catwalks_subdivision_cles(VARIADIC ARRAY[${v.a1nom}, ${v.a1}]::text[]),
        ${v.lat}, ${v.lon}, 10000, 'PPL', true, ${RELEASE})`;
    await db.$executeRaw`INSERT INTO "GeoCityName" ("countryCode", "nameKey", "cityId", "primary") VALUES (${v.pays}, catwalks_lieu_cle(${v.name}), ${v.id}, true)`;
  }
}
async function vider() {
  await db.$executeRaw`DELETE FROM "GeoCity" WHERE "releaseId" = ${RELEASE}`;
  await db.$executeRaw`DELETE FROM "GeoCityRelease" WHERE "id" = ${RELEASE}`;
}
beforeAll(semer);
afterAll(async () => { await vider(); await db.$disconnect(); });

async function source(kind = 'generic-listing') {
  const key = `pays-${randomUUID()}`;
  await db.source.create({ data: { key, maison: key, kind, config: {}, tenantKey: key, tier: 'EMPLOYER_DIRECT' } });
  return key;
}
/** Une offre Boots telle que le JSON-LD de boots.jobs la publie : lieu dans l'adresse de rue, aucun pays, un point natif. */
const boots = (key: string, id: string, street: string, point: [number, number]) => {
  // L'identité d'une page JSON-LD est l'empreinte de son adresse (`normalizeGenericPosting`) : le rattrapage la relit.
  const url = `https://www.boots.jobs/jobs/${key}-${id}`;
  return { company: key, companyId: key, sourceKey: key, sourceTier: 'EMPLOYER_DIRECT' as const, atsType: 'GENERIC_JSONLD' as const,
    externalId: createHash('sha1').update(url).digest('hex'), title: 'Customer Assistant', location: street, url,
    description: 'Serve our customers in store.',
    raw: { '@type': 'JobPosting', '@context': 'https://schema.org', title: 'Customer Assistant', description: 'Serve our customers in store.',
      datePosted: '2026-09-30', url, catwalksPageUrl: url, hiringOrganization: { '@type': 'Organization', name: 'Boots' },
      jobLocation: { '@type': 'Place',
        address: { '@type': 'PostalAddress', streetAddress: street, addressLocality: '-', addressRegion: '-', postalCode: '-' },
        geo: { '@type': 'GeoCoordinates', latitude: String(point[0]), longitude: String(point[1]) } } } };
};
const simple = (key: string, externalId: string, location: string) => ({ company: key, companyId: key, sourceKey: key,
  sourceTier: 'EMPLOYER_DIRECT' as const, atsType: 'GENERIC_JSONLD' as const, externalId, title: 'Vendeur', location,
  url: `https://example.com/${key}/${externalId}`, raw: { '@type': 'JobPosting', title: 'Vendeur', jobLocation: { address: { addressLocality: location } } } });

describe('la preuve de pays à l’ingestion', () => {
  it('Boots : le point natif et la ville concordent → GB, puis la ville et le point de proximité (D-496)', async () => {
    const key = await source();
    const { jobId } = await upsertDeduplicated(db, boots(key, 'b1', 'Aberdeen, Bon Accord Centre', [57.1497, -2.0943]));
    const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { sources: true } });
    expect(job.city).toBe('Aberdeen');
    expect(VILLES.filter((v) => v.name === 'Aberdeen').map((v) => v.pays)).toEqual(['GB', 'US', 'AU']); // prémisse : ville ambiguë
    expect(job.countryCode).toBe('GB');
    expect(job).toMatchObject({ geoCityId: 97000001, geoSource: 'NATIVE', geoLatitude: 57.1497, geoLongitude: -2.0943 });
    expect((job.sources[0].presentation as { values: { countryCode: string } }).values.countryCode).toBe('GB');
    // Une nouvelle observation garde le pays (le stock rattrapé ne se défait pas).
    await upsertDeduplicated(db, boots(key, 'b1', 'Aberdeen, Bon Accord Centre', [57.1497, -2.0943]));
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).countryCode).toBe('GB');
  });

  it('Intersport : un point en Californie pour un magasin de Morteau n’est jamais un pays, même quand le marché est connu', async () => {
    const key = await source();
    await upsertDeduplicated(db, simple(key, 'p0', 'Paris, France'));
    expect(await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Job" j JOIN "JobSource" s ON s."jobId" = j.id
      WHERE s."sourceKey" = ${key} AND j."countryCode" = 'FR'`).toEqual([{ n: 1n }]); // prémisse : le marché de la source est FR
    const { jobId } = await upsertDeduplicated(db, boots(key, 'i1', 'Morteau', [37.9575, -121.975]));
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).countryCode).toBeNull();
    // Un point loin de toute Aberdeen britannique (Londres) ne confirme pas la ville de l'offre.
    const { jobId: loin } = await upsertDeduplicated(db, boots(key, 'i2', 'Aberdeen, Bon Accord Centre', [51.5074, -0.1278]));
    expect((await db.job.findUniqueOrThrow({ where: { id: loin } })).countryCode).toBeNull();
  });

  it('un pays posé ne se confirme jamais lui-même : seule offre de sa source, sa ville et son État n’ont pas de marché', async () => {
    const key = await source();
    const { jobId } = await upsertDeduplicated(db, simple(key, 'x1', 'Atlanta, GA'));
    await db.$executeRaw`UPDATE "Job" SET "countryCode" = 'US' WHERE id = ${jobId}`; // prémisse : l'offre elle-même porte US
    await upsertDeduplicated(db, simple(key, 'x1', 'Atlanta, GA'));
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).countryCode).toBeNull();
  });

  it('R-125 §1 : une ville seule ne donne jamais de pays, même connue d’un seul pays et dans le marché de la source', async () => {
    const key = await source();
    const { jobId: paris } = await upsertDeduplicated(db, simple(key, 'p1', 'Paris, France'));
    expect((await db.job.findUniqueOrThrow({ where: { id: paris } })).countryCode).toBe('FR'); // prémisse : le marché est FR
    expect(VILLES.filter((v) => v.name === 'Vanves').map((v) => v.pays)).toEqual(['FR']); // prémisse : Vanves n'est qu'en France
    const { jobId: vanves } = await upsertDeduplicated(db, simple(key, 'v1', 'Vanves'));
    expect(await db.job.findUniqueOrThrow({ where: { id: vanves } })).toMatchObject({ countryCode: null, geoCityId: null });
    // Une ville et son État hors du marché de la source : refusée.
    const { jobId: atlanta } = await upsertDeduplicated(db, simple(key, 'a1', 'Atlanta, GA'));
    expect((await db.job.findUniqueOrThrow({ where: { id: atlanta } })).countryCode).toBeNull();
    const { jobId: mans } = await upsertDeduplicated(db, simple(key, 'm1', 'LE-MANS, 72000, Pays de la Loire'));
    const leMans = await db.job.findUniqueOrThrow({ where: { id: mans } });
    expect(leMans.city).toBe('Mans'); // prémisse : la ville lue n'existe qu'en Turquie
    expect(leMans.countryCode).toBeNull();
  });

  it('« Atlanta, GA » : la chaîne s’abstient (GA est aussi le Gabon), la ville et l’État le prouvent', async () => {
    const key = await source();
    await upsertDeduplicated(db, simple(key, 'u1', 'Chicago, Illinois, USA'));
    const { jobId } = await upsertDeduplicated(db, simple(key, 'u2', 'Atlanta, GA'));
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ countryCode: 'US', adminArea1: 'Georgia', geoCityId: 97000007 });
  });
});

describe('le rattrapage du stock', () => {
  it('aperçu, application du seul fichier relu, journal, indexation ; puis plus rien à rattraper', async () => {
    const key = await source();
    const { jobId } = await upsertDeduplicated(db, boots(key, 's1', 'Aberdeen, Bon Accord Centre', [57.1497, -2.0943]));
    // L'état d'avant le correctif : le pays effacé sur l'offre et sur la présentation de sa publication.
    await db.$executeRaw`UPDATE "JobSource" SET "presentation" = jsonb_set("presentation", '{values,countryCode}', 'null'::jsonb) WHERE "jobId" = ${jobId}`;
    await db.$executeRaw`UPDATE "Job" SET "countryCode" = NULL WHERE "id" = ${jobId}`;
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ countryCode: null, geoCityId: null });
    await db.$executeRaw`INSERT INTO "SearchGeneration" (version) VALUES ('pays-d520-test') ON CONFLICT DO NOTHING`;

    const apercu = await previewRattrapagePays(db);
    const mine = apercu.resolutions.filter((r) => r.jobId === jobId);
    expect(mine).toMatchObject([{ motif: 'COORDONNEES_ET_VILLE', apres: { countryCode: 'GB' }, avant: { countryCode: null } }]);
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ countryCode: null }); // l'aperçu n'écrit rien

    // Un fichier modifié après l'aperçu est refusé, sans rien écrire.
    const falsifie = { ...apercu, resolutions: apercu.resolutions.map((r) => r.jobId === jobId ? { ...r, apres: { ...r.apres, countryCode: 'US' } } : r) };
    await expect(applyRattrapagePays(db, falsifie)).rejects.toThrow('REVIEWED_PLAN_INVALID');
    await expect(applyRattrapagePays(db, { ...falsifie, empreinte: empreinteRattrapage(falsifie.resolutions) })).rejects.toThrow('REVIEWED_PLAN_MISMATCH');
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).countryCode).toBeNull();

    // Le fichier relu, tel qu'il revient du disque.
    const report = await applyRattrapagePays(db, JSON.parse(JSON.stringify(apercu)));
    expect(report.skipped).toBe(0);
    const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { sources: true } });
    expect(job).toMatchObject({ countryCode: 'GB', geoCityId: 97000001, geoSource: 'NATIVE' });
    expect((job.sources[0].presentation as { values: { countryCode: string } }).values.countryCode).toBe('GB');
    expect(await db.dataCorrection.findMany({ where: { batchId: report.batchId, entityId: jobId } })).toMatchObject([{ finding: 'D-520_OFFRE_SANS_PAYS',
      after: { countryCode: 'GB' }, evidence: { motif: 'COORDONNEES_ET_VILLE' } }]);
    expect(await db.jobEvent.count({ where: { jobId, type: 'CHANGED', field: 'country', after: 'GB' } })).toBe(1);
    expect(await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM "SearchPending" WHERE id = ${jobId} AND version = 'pays-d520-test'`))
      .toEqual([{ n: 1n }]);

    expect((await previewRattrapagePays(db)).resolutions.filter((r) => r.jobId === jobId)).toEqual([]);
    // Rejouer le même fichier : l'aperçu a changé, rien n'est réécrit.
    await expect(applyRattrapagePays(db, apercu)).rejects.toThrow('REVIEWED_PLAN_MISMATCH');
    await db.$executeRaw`DELETE FROM "SearchGeneration" WHERE version = 'pays-d520-test'`;
  });
});
