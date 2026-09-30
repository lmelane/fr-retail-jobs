/**
 * D-488, MESURE DE LATENCE LOCALE — le jeu de données, sur une base JETABLE uniquement (conteneur `cw-d488-mesure`, volume
 * anonyme supprimé avec lui après la mesure). Reprise telle quelle du jeu de la répétition 2C (branche `ops/2c-activation-v3`,
 * `audits/2026-09-30/repetition-2c/seed.mts`), seule la garde de la base change. Son en-tête d'origine :
 *
 * RÉPÉTITION DE L'ACTIVATION 2C (D-486) — le jeu de données, sur une base JETABLE uniquement.
 *
 * La cible `clone` de db.py n'est pas lisible le 30/09/2026 (conteneur `catwalks-lot4-replay-pg18` arrêté depuis deux
 * semaines, données du 09/09, antérieures aux migrations 2B) : le jeu est reconstruit depuis l'export en lecture seule
 * des offres publiables du 29/09/2026 (`audits/2026-09-28/curation-v3/entrees/offres-preview-2026-09-29.json.gz` :
 * 43 168 couples intitulé / service, 80 741 offres, avec leurs pays), complété aux volumes de production relus le
 * 30/09/2026 à 09:12 UTC (91 336 offres, dont 87 767 actives). Descriptions synthétiques courtes (la base est sur un
 * disque mémoire) ; employeurs tirés de l'export des intitulés ; classification v1 par le moteur (identique à l'octet à
 * la production servie, audit du 29/09/2026) ; `titleRoles` vides et sans version, comme en production.
 *
 * Usage : DATABASE_URL=<base jetable> npx tsx audits/2026-09-30/repetition-2c/seed.mts
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PrismaClient, Prisma } from '@prisma/client';
import { loadOccupationTaxonomy } from '@catwalks/db/occupations';
import { classifyOccupationContent } from '../../../apps/aggregator/src/occupation/persist.js';
import { publicationFixture } from '../../../apps/aggregator/src/test/publication-fixture.js';

const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || url.port !== '56632' || url.pathname !== '/catwalks_d488_mesure')
  throw new Error('Base refusée : la mesure ne tourne que sur le conteneur jetable cw-d488-mesure');

const TOTAL = 91_336, ACTIFS = 87_767; // production, 30/09/2026 09:12 UTC
const prisma = new PrismaClient({ log: [] });
const lire = (f: string) => JSON.parse(gunzipSync(readFileSync(f)).toString('utf8'));
const racine = new URL('../../2026-09-28/curation-v3/entrees/', import.meta.url);
const offres = lire(new URL('offres-preview-2026-09-29.json.gz', racine).pathname) as { couples: { titre: string; service: string | null; offres: number; pays: string[] }[] };
const intitules = lire(new URL('intitules-offres-2026-09-29.json.gz', racine).pathname) as { intitules: { intitule: string; employeursNoms: string[] }[] };

// Tirage déterministe (aucune dépendance à Math.random : la répétition se rejoue à l'identique).
const h = (s: string) => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16);

const employeursDe = new Map(intitules.intitules.map(i => [i.intitule, i.employeursNoms]));
const noms = [...new Set(intitules.intitules.flatMap(i => i.employeursNoms))].sort();
const companyId = (nom: string) => `rep2c-co-${h(nom).toString(36)}-${nom.length}`;

async function main() {
  const t0 = Date.now();
  if (await prisma.job.count()) throw new Error('La base contient déjà des offres : repartir d’une base neuve');
  await prisma.company.createMany({ data: noms.map(nom => ({ id: companyId(nom), name: nom, canonicalKey: `rep2c-${nom.toLowerCase()}`,
    fashionjobsUrl: `resolved:rep2c-${companyId(nom)}`, sector: 'LUXURY' as const })), skipDuplicates: true });
  const catalogue = await loadOccupationTaxonomy(prisma);
  if (catalogue.manifest.id !== 'catwalks-occupations-20260909-v1') throw new Error(`Taxonomie active inattendue : ${catalogue.manifest.id}`);

  // 80 741 offres actives tirées de l'export, puis les actives et fermées qui manquent pour atteindre la production.
  type Ligne = { titre: string; service: string | null; pays: string; actif: boolean };
  const lignes: Ligne[] = [];
  for (const c of offres.couples) {
    const pays = c.pays?.length ? c.pays : ['FR']; // pays absent dans l'export : marché français par défaut (répétition)
    for (let i = 0; i < c.offres; i++) lignes.push({ titre: c.titre, service: c.service, pays: pays[i % pays.length], actif: true });
  }
  const base = lignes.length;
  for (let i = 0; lignes.length < TOTAL; i++) {
    const s = lignes[h(`extra-${i}`) % base];
    lignes.push({ ...s, actif: lignes.length < ACTIFS });
  }

  const classes = new Map<string, ReturnType<typeof classifyOccupationContent>>();
  let n = 0;
  for (let debut = 0; debut < lignes.length; debut += 2000) {
    const lot = lignes.slice(debut, debut + 2000).map(l => {
      const i = n++, id = `rep2c-${String(i).padStart(6, '0')}`;
      const cle = `${l.titre}\u0000${l.service ?? ''}`;
      let c = classes.get(cle);
      if (!c) { c = classifyOccupationContent({ title: l.titre, department: l.service, rawTitle: null, sourceKey: 'rep2c', externalId: undefined }, catalogue); classes.set(cle, c); }
      const employeurs = employeursDe.get(l.titre) ?? noms;
      const nom = employeurs[h(id) % employeurs.length];
      const jour = new Date(Date.UTC(2026, 7, 1) + (h(`j${id}`) % 60) * 86_400_000);
      return { l, id, nom, jour, c };
    });
    await prisma.job.createMany({ data: lot.map(({ l, id, nom, jour, c }) => ({
      id, companyId: companyId(nom), externalId: id, source: 'GENERIC_JSONLD' as const, title: l.titre, department: l.service,
      countryCode: l.pays, url: `https://example.com/rep2c/${id}`, isActive: l.actif, postedAt: jour, firstSeenAt: jour,
      description: `${l.titre}. ${l.service ?? ''} Poste en boutique, service client, conseil et vente.`,
      canonicalSourceKey: 'rep2c', canonicalExternalId: id,
      jobFunction: c.jobFunction, occupationCode: c.occupationCode, normalizedTitle: c.normalizedTitle,
      occupationStatus: c.occupationStatus, occupationEvidence: { ...c.occupationEvidence, externalId: id } as Prisma.InputJsonValue,
      occupationReleaseId: c.occupationReleaseId, seniority: c.seniority,
    })) });
    await prisma.jobSource.createMany({ data: lot.map(({ l, id, jour }) => ({
      jobId: id, sourceKey: 'rep2c', sourceTier: 'ATS_OFFICIAL', externalId: id, url: `https://example.com/rep2c/${id}`, isActive: l.actif,
      ...publicationFixture({ sourceKey: 'rep2c', sourceTier: 'ATS_OFFICIAL', externalId: id, url: `https://example.com/rep2c/${id}`, title: l.titre, postedAt: jour, country: l.pays }),
    })) });
    if (debut % 20000 === 0) console.log({ ecrites: debut + lot.length, s: Math.round((Date.now() - t0) / 1000) });
  }
  const etat = await prisma.$queryRaw<{ total: number; actifs: number; classees: number }[]>`SELECT count(*)::int total,
    count(*) FILTER (WHERE "isActive")::int actifs, count(*) FILTER (WHERE "isActive" AND "occupationStatus"='CLASSIFIED')::int classees FROM "Job"`;
  console.log({ ...etat[0], couplesDistincts: classes.size, employeurs: noms.length, secondes: Math.round((Date.now() - t0) / 1000) });
}
try { await main(); } finally { await prisma.$disconnect(); }
