/**
 * D-500 (Q3) — LA GRAINE DU PARCOURS AU NAVIGATEUR : une base JETABLE locale (nom contenant « test », hôte local, refus
 * sinon), migrée, la taxonomie v3 active, l'extrait réel de la base de villes, et des offres dont les intitulés viennent
 * de la mesure du 01/10/2026 (France et Émirats). Le site local interroge l'API locale de l'agrégateur, branchée sur
 * cette base : `src/components/emplois/__tests__/comprehension-requete-d500.e2e.ts` du site.
 *
 *   DATABASE_URL=postgresql://…@127.0.0.1:<port>/<base_test> npx tsx audits/2026-10-01/d500-requete/e2e-graine.mts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const url = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/test/i.test(url.pathname)) throw new Error('Base refusée : locale et jetable seulement');
const { prisma } = await import('@catwalks/db');
const database = await import('@catwalks/db/occupations');
const { publicationFixture } = await import('../../../apps/aggregator/src/test/publication-fixture');
const { semerVilles, viderVilles } = await import('../../../apps/api/lib/__fixtures__/villes');
const { drainSearchIndex, initializeSearchIndex } = await import('../../../apps/api/lib/search-index');

const P = 'e2e-d500-';
const manifest = JSON.parse(readFileSync(join(new URL('.', import.meta.url).pathname, '..', '..', '2026-09-28', 'curation-v3', '6-manifeste-v3.json'), 'utf8'));
if (!(await prisma.occupationRelease.findUnique({ where: { id: manifest.id } })))
  await prisma.occupationRelease.create({ data: { id: manifest.id, contentHash: database.occupationManifestHash(manifest), manifest } });
await prisma.occupationState.upsert({ where: { id: 'active' }, create: { id: 'active', releaseId: manifest.id }, update: { releaseId: manifest.id } });
await prisma.jobSource.deleteMany({ where: { jobId: { startsWith: P } } });
await prisma.job.deleteMany({ where: { id: { startsWith: P } } });
await prisma.company.deleteMany({ where: { id: { startsWith: P } } });
await viderVilles(prisma);
await semerVilles(prisma);
const catalogue = await database.loadOccupationTaxonomy(prisma);

type Offre = { titre: string; classe?: string; ville: string; pays: string; n?: number; autreMaison?: boolean };
const OFFRES: Offre[] = [
  { titre: 'Conseiller de vente H/F', classe: 'Conseiller de vente', ville: 'Paris', pays: 'FR', n: 6 },
  { titre: 'CONSEILLER DE VENTE /NB', classe: 'Conseiller de vente', ville: 'Paris', pays: 'FR', n: 2 },
  { titre: 'Conseillère de vente', classe: 'Conseiller de vente', ville: 'Lyon', pays: 'FR', n: 3 },
  { titre: 'Conseillère beauté', classe: 'Conseiller beauté', ville: 'Paris', pays: 'FR', n: 2 },
  { titre: 'Vendeur polyvalent CDD Toulouse', ville: 'Toulouse', pays: 'FR', n: 2 },
  { titre: 'Vendeur polyvalent (H/F)', ville: 'Toulouse', pays: 'FR', autreMaison: true },
  { titre: 'Responsable boutique', classe: 'Responsable de boutique', ville: 'Paris', pays: 'FR', n: 2 },
  { titre: 'Sales Advisor', classe: 'Sales advisor', ville: 'Dubai', pays: 'AE', n: 3 },
  { titre: 'Senior Sales Advisor - Dubai Mall', classe: 'Sales advisor', ville: 'Dubai', pays: 'AE', n: 2 },
  { titre: 'Store Manager', classe: 'Store manager', ville: 'Dubai', pays: 'AE' },
];
for (const [c, nom] of [[`${P}maison`, 'Maison Témoin D500'], [`${P}maison-2`, 'Seconde Maison Témoin D500']] as const)
  await prisma.company.create({ data: { id: c, name: nom, canonicalKey: c, fashionjobsUrl: `resolved:${c}`, sector: 'LUXURY' } });
let i = 0;
for (const o of OFFRES) for (let k = 0; k < (o.n ?? 1); k++) {
  const id = `${P}${String(i++).padStart(2, '0')}`;
  const lien = `https://example.com/${id}`;
  const decision = o.classe ? database.persistedOccupationDecision(catalogue.classify(o.classe)) : {};
  await prisma.job.create({ data: { id, companyId: o.autreMaison ? `${P}maison-2` : `${P}maison`, externalId: id, source: 'GENERIC_JSONLD', title: o.titre, url: lien, isActive: true,
    countryCode: o.pays, city: o.ville, location: o.ville, ...decision, postedAt: new Date(Date.UTC(2026, 8, 1 + i, 8)),
    firstSeenAt: new Date('2026-09-01T09:00:00Z'), lastSeenAt: new Date() } });
  await prisma.jobSource.create({ data: { jobId: id, sourceKey: 'e2e-d500', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, isActive: true,
    ...publicationFixture({ sourceKey: 'e2e-d500', sourceTier: 'ATS_OFFICIAL', externalId: id, url: lien, title: o.titre, country: o.pays }) } });
}
await initializeSearchIndex();
while (await drainSearchIndex()) { /* index à jour */ }
console.log(`${i} offres semées, ${await prisma.geoCity.count()} lieux`);
await prisma.$disconnect();
process.exit(0);
