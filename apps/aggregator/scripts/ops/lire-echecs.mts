/**
 * LE DÉTAIL DES ÉCHECS DU PIPELINE — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/lire-echecs.mts [<heures>]
 *
 * `PipelineEvent.payload` porte la raison ; la liste des événements seule ne la montre pas.
 * On agrège donc par (événement, raison) pour distinguer un défaut systémique d'un cas isolé.
 */
import { PrismaClient } from '@prisma/client';

const heures = Number(process.argv[2] ?? 6);
const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T,>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);

console.log(`\n── événements sur ${heures} h, par type et niveau ──\n`);
const parType = await q<{ event: string; level: string; n: bigint; dernier: Date }>(`
  SELECT event, level, count(*) AS n, max(at) AS dernier FROM "PipelineEvent"
   WHERE at > now() - interval '${heures} hours' GROUP BY 1,2 ORDER BY count(*) DESC LIMIT 25`);
for (const r of parType)
  console.log(`   ${r.level.padEnd(6)} ${r.event.padEnd(34)} ${String(r.n).padStart(6)}   dernier ${r.dernier.toISOString().slice(11, 19)}`);

console.log(`\n── les raisons des échecs (payload) ──\n`);
const raisons = await q<{ event: string; sourceKey: string | null; raison: string; n: bigint }>(`
  SELECT event, "sourceKey",
         left(coalesce(payload->>'reason', payload->>'error', payload->>'message',
                       payload->>'code', payload::text), 150) AS raison,
         count(*) AS n
    FROM "PipelineEvent"
   WHERE at > now() - interval '${heures} hours' AND level = 'error'
   GROUP BY 1,2,3 ORDER BY count(*) DESC LIMIT 20`);
for (const r of raisons)
  console.log(`   ${String(r.n).padStart(5)}  ${r.event.padEnd(20)} ${(r.sourceKey ?? '—').padEnd(24)} ${r.raison}`);

console.log(`\n── les exécutions (run.started / run.completed / command.*) ──\n`);
const runs = await q<{ at: Date; event: string; level: string; payload: unknown }>(`
  SELECT at, event, level, payload FROM "PipelineEvent"
   WHERE at > now() - interval '${heures} hours'
     AND event IN ('run.started','run.completed','command.result','command.failed','ingest.sources_selected')
   ORDER BY at DESC LIMIT 25`);
for (const r of runs)
  console.log(`   ${r.at.toISOString().slice(11, 19)} ${r.level.padEnd(6)} ${r.event.padEnd(26)} ${JSON.stringify(r.payload).slice(0, 190)}`);

console.log('');
await prisma.$disconnect();
