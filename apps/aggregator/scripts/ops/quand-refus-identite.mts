/**
 * LES REFUS D'IDENTITÉ SONT-ILS ANTÉRIEURS AU CORRECTIF F6 ? — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/quand-refus-identite.mts
 *
 * Le lot F6 (18/09/2026) a levé l'exigence d'antériorité qui bloquait la première offre de chaque
 * source — le commentaire de `identity/resolve.ts:113` cite nommément « lovisa : Lovisa proposé
 * pour Lovisa, 1 062 offres bloquées ». Si les refus mesurés aujourd'hui sont ANTÉRIEURS à ce
 * correctif, le défaut est déjà réparé et le compteur ne fait que garder la trace du passé.
 * S'ils sont POSTÉRIEURS, le correctif ne tient pas et c'est un défaut ouvert.
 *
 * La question ne se tranche que par la DATE des événements, jamais par la lecture du code.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });
const q = <T,>(s: string) => prisma.$queryRawUnsafe<T[]>(s);

console.log('\n── refus d\'identité employeur, par jour et par heure ──\n');
const parHeure = await q<{ quand: string; n: bigint; sources: bigint }>(`
  SELECT to_char(at, 'YYYY-MM-DD HH24') || 'h' AS quand, count(*) AS n, count(DISTINCT "sourceKey") AS sources
    FROM "PipelineEvent"
   WHERE event='job.write_failed' AND payload->'error'->>'name'='EmployerIdentityReviewRequired'
   GROUP BY 1 ORDER BY 1 DESC LIMIT 25`);
for (const r of parHeure) console.log(`   ${r.quand}   ${String(r.n).padStart(6)} refus   ${String(r.sources).padStart(3)} source(s)`);

console.log('\n── le cas nommé dans le commentaire du correctif : lovisa ──\n');
const lovisa = await q<{ quand: string; n: bigint }>(`
  SELECT to_char(at, 'YYYY-MM-DD HH24:MI') AS quand, count(*) AS n
    FROM "PipelineEvent"
   WHERE event='job.write_failed' AND payload->'error'->>'name'='EmployerIdentityReviewRequired'
     AND "sourceKey"='lovisa'
   GROUP BY 1 ORDER BY 1 DESC LIMIT 10`);
for (const r of lovisa) console.log(`   ${r.quand}   ${r.n} refus`);
if (!lovisa.length) console.log('   aucun refus tracé pour lovisa');

console.log('\n── et depuis le début de la collecte d\'aujourd\'hui (après 10:00) ? ──\n');
const aujourdhui = await q<{ sourceKey: string; attendu: string; n: bigint }>(`
  SELECT "sourceKey", payload->'error'->>'proposedName' AS attendu, count(*) AS n
    FROM "PipelineEvent"
   WHERE event='job.write_failed' AND payload->'error'->>'name'='EmployerIdentityReviewRequired'
     AND at > date_trunc('day', now()) + interval '10 hours'
   GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 20`);
if (!aujourdhui.length) console.log('   AUCUN refus depuis 10:00 — le correctif tient.');
for (const r of aujourdhui) console.log(`   ${r.sourceKey.padEnd(26)} ${String(r.n).padStart(5)}  → ${r.attendu}`);

console.log('');
await prisma.$disconnect();
