/**
 * ÉCART ENTRE LE RÉFÉRENTIEL FASHIONJOBS ET CE QUE NOUS COLLECTONS — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/ecart-fashionjobs.mts
 *
 * ── LA QUESTION ────────────────────────────────────────────────────────────────────────────────
 *
 * FashionJobs affiche ~9 590 offres pour la seule France. Notre catalogue en publie un ordre de
 * grandeur en dessous sur le même pays. Les deux chiffres ne portent PAS sur la même population —
 * FashionJobs agrège tout le marché, nous collectons le portail de chaque Maison du registre —
 * mais l'écart mérite d'être décomposé plutôt que raconté.
 *
 * Ce script répond à trois questions, dans cet ordre :
 *
 *   1. Combien de Maisons le registre tient-il, et combien viennent de la découverte FashionJobs ?
 *   2. Combien d'entre elles n'ont AUCUNE source collectable ? (= le gisement perdu à la découverte)
 *   3. Pour celles qui EN ont une, combien d'offres FR publient-elles chez nous ?
 *
 * `Company.fashionjobsUrl` porte l'origine : une URL `http…` = Maison vue sur FashionJobs ;
 * `resolved:<clé>` = Maison créée par une autre voie (import de registre, domaine divergent relu).
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL (ou DATABASE_URL) manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

const ligne = (libelle: string, valeur: bigint | number) =>
  console.log(`   ${libelle.padEnd(52)} ${String(valeur).padStart(7)}`);

const registre = await q<{ quoi: string; n: bigint }>(`
  SELECT 'Maisons au registre' AS quoi, count(*) AS n FROM "Company"
  UNION ALL SELECT 'avec un domaine officiel', count(*) FROM "Company" WHERE domain IS NOT NULL AND domain <> ''
`);
console.log('\n═══ 1. LE RÉFÉRENTIEL ═══\n');
for (const r of registre) ligne(r.quoi, r.n);

/*
 * D'OÙ VIENNENT LES MAISONS. `fashionjobsUrl` est une colonne UNIQUE qui sert de clé d'origine.
 * On ne suppose pas ce qu'elle contient : on compte ses formes réellement présentes en base.
 */
console.log('\n   Origine des Maisons (préfixe de `fashionjobsUrl`) :\n');
const origines = await q<{ forme: string; n: bigint }>(`
  SELECT CASE
           WHEN "fashionjobsUrl" LIKE 'http%' THEN 'URL FashionJobs'
           WHEN "fashionjobsUrl" LIKE '%:%' THEN split_part("fashionjobsUrl", ':', 1) || ':…'
           ELSE 'autre' END AS forme,
         count(*) AS n
    FROM "Company" GROUP BY 1 ORDER BY count(*) DESC
`);
for (const r of origines) ligne(`      ${r.forme}`, r.n);

const portails = await q<{ quoi: string; n: bigint }>(`
  SELECT 'Sources (portails) au total' AS quoi, count(*) AS n FROM "Source"
  UNION ALL SELECT 'ACTIVE', count(*) FROM "Source" WHERE status='ACTIVE'
  UNION ALL SELECT 'RETIRED', count(*) FROM "Source" WHERE status='RETIRED'
`);
console.log('\n═══ 2. CE QUI EST COLLECTABLE ═══\n');
for (const r of portails) ligne(r.quoi, r.n);

/*
 * LE GISEMENT PERDU. Le rapprochement se fait sur `Source.maison = Company.name`, par égalité
 * EXACTE — le même chemin que la campagne de qualification emprunte. Un rapprochement flou
 * attribuerait le portail d'une Maison à une autre.
 *
 * Une Maison sans source n'est pas une erreur : c'est une Maison identifiée dont le portail
 * n'a jamais été branché. C'est très exactement le gisement qui explique un écart de volume.
 */
const couverture = await q<{ quoi: string; n: bigint }>(`
  SELECT 'Maisons SANS aucune source' AS quoi,
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "Source" s WHERE s.maison = c.name)) AS n
    FROM "Company" c
  UNION ALL
  SELECT 'Maisons sans source ACTIVE',
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "Source" s WHERE s.maison = c.name AND s.status='ACTIVE'))
    FROM "Company" c
  UNION ALL
  SELECT 'Maisons AVEC une source ACTIVE',
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "Source" s WHERE s.maison = c.name AND s.status='ACTIVE'))
    FROM "Company" c
`);
console.log('\n═══ 3. LE GISEMENT NON BRANCHÉ ═══\n');
for (const r of couverture) ligne(r.quoi, r.n);

/* `isActive` est le drapeau de publication du catalogue (cf. bilan-collecte.mts). */
const offres = await q<{ quoi: string; n: bigint }>(`
  SELECT 'Offres au catalogue (toutes)' AS quoi, count(*) AS n FROM "Job"
  UNION ALL SELECT 'dont actives', count(*) FROM "Job" WHERE "isActive"
  UNION ALL SELECT 'actives en France', count(*) FROM "Job" WHERE "isActive" AND "countryCode"='FR'
  UNION ALL SELECT 'Maisons distinctes publiant en France',
    count(DISTINCT "companyId") FROM "Job" WHERE "isActive" AND "countryCode"='FR'
`);
console.log('\n═══ 4. CE QUE NOUS PUBLIONS AUJOURD\'HUI ═══\n');
for (const r of offres) ligne(r.quoi, r.n);

console.log('\n═══ 5. LES 25 MAISONS QUI PUBLIENT LE PLUS EN FRANCE ═══\n');
const top = await q<{ name: string; n: bigint }>(`
  SELECT c.name, count(*) AS n
    FROM "Job" j JOIN "Company" c ON c.id = j."companyId"
   WHERE j."isActive" AND j."countryCode"='FR'
   GROUP BY c.name ORDER BY count(*) DESC LIMIT 25
`);
for (const r of top) console.log(`   ${String(r.n).padStart(5)}  ${r.name}`);

await prisma.$disconnect();
