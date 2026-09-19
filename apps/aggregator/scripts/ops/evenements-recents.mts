/**
 * LES ÉVÉNEMENTS DE PIPELINE LES PLUS RÉCENTS — lecture seule.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx \
 *     apps/aggregator/scripts/ops/evenements-recents.mts [<minutes>]
 *
 * Quand une exécution distante ne laisse ni verdict lisible ni `SourceRun`, c'est `PipelineEvent`
 * qui dit ce qui s'est réellement passé dans le conteneur. On lit la fenêtre demandée, du plus
 * récent au plus ancien, sans rien filtrer d'autre que le temps.
 */
import { PrismaClient } from '@prisma/client';

const minutes = Number(process.argv[2] ?? 30);
const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) { console.error('DB_URL manquante.'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T>(s: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(s, ...p);

const cols = (await q<{ column_name: string }>(
  `SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='PipelineEvent' ORDER BY ordinal_position`))
  .map((c) => c.column_name);
console.log(`\n── colonnes de PipelineEvent : ${cols.join(', ')}\n`);

const dateCol = cols.find((c) => /^(createdAt|occurredAt|at|ranAt|timestamp)$/i.test(c)) ?? cols[cols.length - 1];

const lignes = await q<Record<string, unknown>>(
  `SELECT * FROM "PipelineEvent" WHERE "${dateCol}" > now() - interval '${minutes} minutes'
    ORDER BY "${dateCol}" DESC LIMIT 60`);
console.log(`── ${lignes.length} événement(s) sur ${minutes} minute(s) ──\n`);
for (const l of lignes) {
  const plat = Object.fromEntries(Object.entries(l).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v]));
  console.log(`   ${JSON.stringify(plat).slice(0, 300)}`);
}

/* Le compte par type sur une fenêtre plus large, pour savoir ce que le pipeline émet d'habitude. */
const types = cols.find((c) => /type|kind|name|event/i.test(c));
if (types) {
  console.log(`\n── répartition par « ${types} » sur 24 h ──\n`);
  const r = await q<{ t: string; n: bigint }>(
    `SELECT "${types}" AS t, count(*) AS n FROM "PipelineEvent"
      WHERE "${dateCol}" > now() - interval '24 hours' GROUP BY 1 ORDER BY count(*) DESC LIMIT 25`);
  for (const x of r) console.log(`   ${String(x.t).padEnd(44)} ${x.n}`);
}

console.log('');
await prisma.$disconnect();
