/**
 * LA TAILLE DE CE QU'ON GARDE — mesurée table par table, avant et après un corpus.
 *
 * Une capacité qui ignore le stockage n'en est pas une : un pipeline qui tient en temps et en mémoire mais
 * double la base chaque semaine n'est pas soutenable. P8 doit donc pouvoir répondre « combien d'octets coûte
 * une passe idempotente », c'est-à-dire une passe qui ne crée AUCUNE offre — la réponse n'est pas zéro, parce
 * que l'observabilité, elle, écrit toujours.
 *
 * Les tailles viennent de `pg_total_relation_size` (table + index + TOAST) : mesurer la table seule
 * sous-estimerait le coût réel, l'index étant précisément ce qui grossit avec les lignes.
 *
 * usage: db.py readonly npx tsx scripts/ops/storage-snapshot.mts [--out=<f.json>] [--compare=<avant.json>]
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync, readFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);

const TABLES = ['Job', 'JobSource', 'SourceRun', 'PipelineRun', 'PipelineEvent', 'SourceObservation',
                'Company', 'JobEvent', 'MarketSnapshot', 'Source', 'SourceFieldTrustObservation'];

const prisma = new PrismaClient();

const rows: any[] = await prisma.$queryRawUnsafe(`
  SELECT c.relname AS table,
         pg_total_relation_size(c.oid)::bigint AS total_bytes,
         pg_table_size(c.oid)::bigint          AS table_bytes,
         pg_indexes_size(c.oid)::bigint        AS index_bytes,
         c.reltuples::bigint                   AS estimated_rows
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1)
  ORDER BY pg_total_relation_size(c.oid) DESC`, TABLES);

/** Les comptes EXACTS des tables qui décident : `reltuples` est une estimation du planificateur, pas un compte. */
const exact: any[] = await prisma.$queryRawUnsafe(`
  SELECT (SELECT count(*) FROM "Job")::int AS jobs,
         (SELECT count(*) FROM "JobSource")::int AS job_sources,
         (SELECT count(*) FROM "PipelineEvent")::int AS pipeline_events,
         (SELECT count(*) FROM "SourceRun")::int AS source_runs,
         (SELECT count(*) FROM "SourceObservation")::int AS source_observations`);

const [dbSize]: any[] = await prisma.$queryRawUnsafe(
  `SELECT pg_database_size(current_database())::bigint AS bytes`);

const snapshot = {
  at: new Date().toISOString(),
  databaseBytes: Number(dbSize.bytes),
  counts: Object.fromEntries(Object.entries(exact[0] ?? {}).map(([k, v]) => [k, Number(v)])),
  tables: rows.map((r) => ({
    table: r.table,
    totalBytes: Number(r.total_bytes),
    tableBytes: Number(r.table_bytes),
    indexBytes: Number(r.index_bytes),
  })),
};

const compareFile = arg('compare');
if (compareFile) {
  const before = JSON.parse(readFileSync(compareFile, 'utf8'));
  const beforeTables = new Map(before.tables.map((t: any) => [t.table, t]));
  const deltas = snapshot.tables.map((t) => {
    const b: any = beforeTables.get(t.table);
    return {
      table: t.table,
      beforeBytes: b?.totalBytes ?? null,
      afterBytes: t.totalBytes,
      deltaBytes: b ? t.totalBytes - b.totalBytes : null,
    };
  }).filter((d) => d.deltaBytes === null || d.deltaBytes !== 0);
  const countDeltas = Object.fromEntries(Object.entries(snapshot.counts).map(
    ([k, v]) => [k, { before: before.counts?.[k] ?? null, after: v,
                      delta: before.counts?.[k] != null ? (v as number) - before.counts[k] : null }]));
  (snapshot as any).comparison = {
    databaseDeltaBytes: snapshot.databaseBytes - before.databaseBytes,
    tables: deltas,
    counts: countDeltas,
    // La taille d'une base bouge aussi sans nous (autovacuum, statistiques) : un delta n'est pas une
    // imputation. On le dit, plutôt que d'attribuer au run tout ce qui a changé.
    caveat: 'un delta de taille inclut autovacuum et statistiques : il majore ce que le run a écrit',
  };
}

const out = arg('out');
if (out) writeFileSync(out, JSON.stringify(snapshot, null, 2));
console.log(JSON.stringify(snapshot, null, 1));
await prisma.$disconnect();
