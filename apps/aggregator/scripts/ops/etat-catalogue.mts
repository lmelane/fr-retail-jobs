/**
 * L'ÉTAT RÉEL DU CATALOGUE — lecture seule, compté en base, jamais lu dans un rapport.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/etat-catalogue.mts
 *
 * Un fichier de verdicts dit ce que la campagne a CRU rendre. Cette requête dit ce qui est
 * réellement écrit : revues d'identité vérifiées, décisions d'accès, offres publiées. Les deux
 * doivent concorder ; quand ils divergent, c'est la base qui a raison.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

const [totaux] = await prisma.$queryRawUnsafe<Array<Record<string, number>>>(`
  SELECT (SELECT count(*) FROM "Job")::int                                              AS offres,
         (SELECT count(*) FROM "Job" WHERE "isActive")::int                             AS offres_actives,
         (SELECT count(*) FROM "JobSource")::int                                        AS liens_offre_source,
         (SELECT count(DISTINCT "sourceKey") FROM "JobSource")::int                     AS sources_avec_offres,
         (SELECT count(*) FROM "SourceIdentityReview" WHERE verdict = 'VERIFIED')::int  AS identites_verifiees,
         (SELECT count(*) FROM "SourceAccessDecision")::int                             AS decisions_acces,
         (SELECT count(*) FROM "Source" WHERE status = 'ACTIVE')::int                   AS sources_actives`);

console.log('\nCATALOGUE — compté en base');
for (const [k, v] of Object.entries(totaux)) {
  console.log(`   ${k.replace(/_/g, ' ').padEnd(24)} ${String(v).padStart(6)}`);
}

const parSource = await prisma.$queryRawUnsafe<Array<{ sourceKey: string; offres: number }>>(`
  SELECT "sourceKey", count(*)::int AS offres
    FROM "JobSource" GROUP BY "sourceKey" ORDER BY offres DESC, "sourceKey"`);

if (parSource.length) {
  console.log(`\n   OFFRES PAR SOURCE`);
  for (const r of parSource) console.log(`   ${r.sourceKey.padEnd(28)} ${String(r.offres).padStart(5)}`);
}

const identites = await prisma.$queryRawUnsafe<Array<{ sourceKey: string; method: string; officialDomain: string }>>(`
  SELECT DISTINCT ON ("sourceKey") "sourceKey", method, "officialDomain"
    FROM "SourceIdentityReview" WHERE verdict = 'VERIFIED'
    ORDER BY "sourceKey", sequence DESC NULLS LAST, "createdAt" DESC`);

if (identites.length) {
  console.log(`\n   IDENTITÉS VÉRIFIÉES`);
  for (const r of identites) console.log(`   ${r.sourceKey.padEnd(28)} ${r.method.padEnd(16)} ${r.officialDomain}`);
}
console.log('');

await prisma.$disconnect();
