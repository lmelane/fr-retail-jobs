/**
 * AVONS-NOUS LE RAW NATIF DE CHAQUE OFFRE PUBLIÉE ? — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/couverture-raw.mts
 *
 * ── POURQUOI CETTE QUESTION EST STRUCTURANTE ───────────────────────────────────────────────────
 *
 * Les filtres du jobboard (pays, métier, contrat, temps de travail) se construisent en relisant
 * ce que les sources ont RÉELLEMENT publié, pas ce que notre normalisation en a fait. Sans la
 * capture native, une règle de filtre ne peut ni être établie sur des cas réels, ni être rejouée
 * quand on la corrige : il faudrait recollecter, donc redemander aux sites, donc dépendre de leur
 * disponibilité du jour.
 *
 * La réponse ne se déduit NI du nombre de captures NI des invariants de collecte : un invariant
 * vert dit « aucune offre sans capture parmi celles que la chaîne a contrôlées », ce qui n'est pas
 * la même affirmation que « chaque offre publiée a son corps natif relisible aujourd'hui ».
 *
 * Ce script vérifie la chaîne complète, maillon par maillon, sur les offres ACTIVES :
 *
 *   Job (isActive)  →  JobSource  →  capture du lot  →  RawBlob  →  RawBlobBody (le corps)
 *
 * Un trou à n'importe quel maillon casse la relecture hors réseau. On compte donc chacun.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T,>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

const ligne = (l: string, v: bigint | number, marque = '') =>
  console.log(`   ${l.padEnd(52)} ${String(v).padStart(8)}  ${marque}`);

console.log('\n═══ LES VOLUMES ═══\n');
const vol = await q<{ quoi: string; n: bigint }>(`
  SELECT 'offres actives au catalogue' AS quoi, count(*) AS n FROM "Job" WHERE "isActive"
  UNION ALL SELECT 'liens JobSource (offre ↔ source)', count(*) FROM "JobSource"
  UNION ALL SELECT 'captures RAW (RawBlob)', count(*) FROM "RawBlob"
  UNION ALL SELECT 'corps de capture (RawBlobBody)', count(*) FROM "RawBlobBody"
`);
for (const r of vol) ligne(r.quoi, r.n);

/*
 * LE MAILLON QUI COMPTE : une offre active dont AUCUN lien JobSource ne porte de capture.
 * On ne suppose pas le nom des colonnes de jointure — on lit le schéma d'abord.
 */
const colsJS = (await q<{ column_name: string }>(`
  SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='JobSource' ORDER BY ordinal_position`))
  .map((c) => c.column_name);
console.log(`\n   colonnes de JobSource : ${colsJS.join(', ')}\n`);

const colCapture = colsJS.find((c) => /capture/i.test(c));
if (!colCapture) {
  console.log('   ⚠ aucune colonne de capture sur JobSource — la chaîne passe par une autre table.');
} else {
  console.log('═══ LA COUVERTURE NATIVE DES OFFRES ACTIVES ═══\n');
  const couv = await q<{ quoi: string; n: bigint }>(`
    SELECT 'offres actives' AS quoi, count(*) AS n FROM "Job" j WHERE j."isActive"
    UNION ALL
    SELECT 'dont au moins un JobSource', count(*) FROM "Job" j WHERE j."isActive"
      AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId" = j.id)
    UNION ALL
    SELECT 'dont au moins un JobSource AVEC capture', count(*) FROM "Job" j WHERE j."isActive"
      AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId" = j.id AND js."${colCapture}" IS NOT NULL)
    UNION ALL
    SELECT 'SANS AUCUNE capture native', count(*) FROM "Job" j WHERE j."isActive"
      AND NOT EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId" = j.id AND js."${colCapture}" IS NOT NULL)
  `);
  for (const r of couv) ligne(r.quoi, r.n, r.quoi.startsWith('SANS') && r.n > 0n ? '← TROU' : r.quoi.startsWith('SANS') ? '✓' : '');
}

/* Le corps est-il encore là ? Un RawBlob sans RawBlobBody n'est plus relisible. */
console.log('\n═══ LE CORPS EST-IL ENCORE RELISIBLE ? ═══\n');
const colsRB = (await q<{ column_name: string }>(`
  SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='RawBlob' ORDER BY ordinal_position`))
  .map((c) => c.column_name);
console.log(`   colonnes de RawBlob : ${colsRB.join(', ')}\n`);

const lien = colsRB.find((c) => /^(bodyHash|hash|bodyId)$/.test(c));
if (lien) {
  const corps = await q<{ quoi: string; n: bigint }>(`
    SELECT 'captures RawBlob' AS quoi, count(*) AS n FROM "RawBlob"
    UNION ALL SELECT 'dont le corps existe', count(*) FROM "RawBlob" b
      WHERE EXISTS (SELECT 1 FROM "RawBlobBody" y WHERE y.hash = b."${lien}")
    UNION ALL SELECT 'CORPS MANQUANT', count(*) FROM "RawBlob" b
      WHERE NOT EXISTS (SELECT 1 FROM "RawBlobBody" y WHERE y.hash = b."${lien}")
  `);
  for (const r of corps) ligne(r.quoi, r.n, r.quoi === 'CORPS MANQUANT' ? (r.n > 0n ? '← TROU' : '✓') : '');
} else {
  console.log(`   ⚠ lien RawBlob → RawBlobBody non identifié parmi : ${colsRB.join(', ')}`);
}

/* Le RAW est-il conservé, ou purgé après un délai ? La réponse change tout pour les filtres. */
console.log('\n═══ ANCIENNETÉ DES CAPTURES CONSERVÉES ═══\n');
const colDate = colsRB.find((c) => /^(capturedAt|createdAt|at|fetchedAt)$/.test(c));
if (colDate) {
  const age = await q<{ jour: string; n: bigint }>(`
    SELECT to_char("${colDate}", 'YYYY-MM-DD') AS jour, count(*) AS n FROM "RawBlob"
     GROUP BY 1 ORDER BY 1 DESC LIMIT 12`);
  for (const r of age) ligne(`   ${r.jour}`, r.n);
}

console.log('');
await prisma.$disconnect();
