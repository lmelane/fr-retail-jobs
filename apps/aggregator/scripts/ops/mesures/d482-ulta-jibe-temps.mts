/**
 * D-482 — Où passe le temps de `ulta-jibe` dans le RUN quotidien, et pourquoi il a été coupé le 28/09/2026.
 *
 * LECTURE SEULE. Chaque requête passe par psql (libpq, donc PGOPTIONS de `db.py readonly` : lecture seule par défaut
 * et délai de 25 s) ET s'exécute dans une transaction `READ ONLY` ouverte par le script : aucune écriture possible,
 * aucune table temporaire. Aucun contact réseau hors de la base.
 *
 * Lancer, depuis la racine du dépôt :
 *   export PYTHONDONTWRITEBYTECODE=1 CATWALKS_DB_ACCESS=<dossier des accès>
 *   python3 apps/aggregator/scripts/ops/db.py readonly node apps/aggregator/scripts/ops/mesures/d482-ulta-jibe-temps.mts
 * Optionnel : RUNS="<runId>,<runId>,…" (défaut : les RUN ingest-all des 7 derniers jours) ; SOURCE=ulta-jibe.
 *
 * Ce que chaque section établit :
 *  1. chronologie des événements de la source par RUN (qualification d'accès, énumération, fin, coupure) ;
 *  2. durée de chaque capture : réseau (1re → dernière RawCapture) puis écriture des extractions ;
 *  3. progression de l'écriture (ordinal des observations nouvelles par tranche de 5 min) ;
 *  4. par RUN, toutes sources : ms d'écriture par offre, CPU consommé par le processus du worker, lots de capture ;
 *  5. sonde de latence base hors transaction : délai entre `source_sync_started` et le début du budget ;
 *  6. top 15 des écarts de durée par source entre les deux derniers RUN comparés.
 */
import { spawnSync } from 'node:child_process';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL absente : lancer via `db.py readonly`.');
if (!/default_transaction_read_only=on/.test(process.env.PGOPTIONS ?? ''))
  throw new Error('PGOPTIONS sans lecture seule : lancer via `db.py readonly`, jamais `production`.');
const source = process.env.SOURCE ?? 'ulta-jibe';
if (!/^[a-z0-9-]+$/.test(source)) throw new Error(`SOURCE invalide : ${source}`);
const uuid = /^[0-9a-f-]{36}$/;

function query(title: string, sql: string): string[][] {
  const out = spawnSync('psql', [url!, '-X', '-A', '-q', '-F', '|', '-v', 'ON_ERROR_STOP=1',
    '-c', `BEGIN TRANSACTION READ ONLY; ${sql}; COMMIT;`], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`${title} : ${out.stderr}`);
  const lines = out.stdout.trim().split('\n').filter(l => l && !/^\(\d+ rows?\)$/.test(l) && l !== 'BEGIN' && l !== 'COMMIT');
  console.log(`\n═══ ${title} ═══`);
  for (const l of lines) console.log('  ' + l);
  return lines.slice(1).map(l => l.split('|'));
}

const runs = process.env.RUNS
  ? process.env.RUNS.split(',').map(s => s.trim())
  : query('RUN ingest-all des 7 derniers jours', `SELECT id, "startedAt", "finishedAt", status FROM "PipelineRun"
      WHERE command='ingest-all' AND "startedAt" > now() - interval '7 days' ORDER BY "startedAt"`).map(r => r[0]);
if (!runs.length || runs.some(r => !uuid.test(r))) throw new Error(`RUNS invalides : ${runs.join(',')}`);
const inRuns = runs.map(r => `'${r}'`).join(',');

query(`1. Chronologie de ${source}`, `SELECT "runId", at, level, event, left(payload::text, 160) AS extrait FROM "PipelineEvent"
  WHERE "sourceKey"='${source}' AND "runId" IN (${inRuns}) AND event IN ('source_sync_started','source.access_qualification_started',
  'source.access_qualification_completed','source.native_qualification_started','source.native_qualification_completed',
  'ingest.sources_selected','source.enumeration_observed','source.ingest_completed','source.ingest_failed','source.timed_out',
  'source.issue_classified','source_sync_completed') ORDER BY at`);

query(`2. Captures de ${source} : réseau puis écriture des extractions`, `SELECT b."runId", b.id, b.purpose,
  b."executionBudget"->>'softTimeoutMs' AS soft_ms, b."startedAt",
  round(extract(epoch FROM max(r."capturedAt") - min(r."capturedAt"))) AS reseau_s, count(r.*) AS requetes,
  round(extract(epoch FROM (SELECT max(se."capturedAt") - min(se."capturedAt") FROM "SourceExtraction" se WHERE se."batchId"=b.id))) AS extractions_s,
  (SELECT count(*) FROM "SourceExtraction" se WHERE se."batchId"=b.id) AS sorties
  FROM "CaptureBatch" b LEFT JOIN "RawCapture" r ON r."batchId"=b.id
  WHERE b."sourceKey"='${source}' AND b."runId" IN (${inRuns}) AND b.purpose='JOBS' GROUP BY b.id ORDER BY b."startedAt"`);

query(`3. Progression de l'écriture de ${source} (ordinal des observations nouvelles, tranches de 5 min)`, `SELECT b."runId",
  date_trunc('minute', so."observedAt") - (extract(minute FROM so."observedAt")::int % 5) * interval '1 min' AS tranche,
  count(*) AS nouvelles, min(se.ordinal) AS ordinal_min, max(se.ordinal) AS ordinal_max
  FROM "SourceObservation" so JOIN "SourceExtraction" se ON se.id=so."captureOutputId" AND se."batchId"=so."captureBatchId"
  JOIN "CaptureBatch" b ON b.id=so."captureBatchId"
  WHERE so."sourceKey"='${source}' AND b."runId" IN (${inRuns}) AND b.purpose='JOBS'
    AND (b."executionBudget"->>'timeoutMs')::bigint - (b."executionBudget"->>'softTimeoutMs')::bigint > 30000 GROUP BY 1,2 ORDER BY 1,2`);

query('4. Par RUN, toutes sources : écriture par offre et CPU du worker', `WITH s AS (SELECT e."runId",
    sum((e.payload->'stats'->0->>'upsertMs')::bigint) AS ups,
    sum(coalesce((e.payload->'stats'->0->>'created')::int,0)+coalesce((e.payload->'stats'->0->>'updated')::int,0)+coalesce((e.payload->'stats'->0->>'merged')::int,0)) AS ecrites
    FROM "PipelineEvent" e WHERE e.event='source_sync_completed' AND e."runId" IN (${inRuns}) GROUP BY 1),
  c AS (SELECT "runId", ((payload->'resources'->'after'->>'cpuUserUs')::bigint + (payload->'resources'->'after'->>'cpuSystemUs')::bigint)/1e6 AS cpu_s,
    (payload->'resources'->>'processUptimeSeconds')::numeric AS mur_s FROM "PipelineEvent" WHERE event='run.completed' AND "runId" IN (${inRuns}))
  SELECT p."startedAt"::date AS jour, s."runId", s.ecrites, round(s.ups::numeric/nullif(s.ecrites,0),1) AS ms_par_offre,
    round(c.cpu_s) AS cpu_worker_s, round(c.mur_s) AS mur_s, round(c.cpu_s/nullif(c.mur_s,0),2) AS coeurs,
    (SELECT count(*) FROM "CaptureBatch" b WHERE b."runId"=s."runId") AS lots_capture
  FROM s JOIN "PipelineRun" p ON p.id=s."runId" LEFT JOIN c ON c."runId"=s."runId" ORDER BY p."startedAt"`);

query('5. Sonde de latence base hors transaction (source_sync_started → début du budget)', `WITH st AS (SELECT "runId" r, "sourceKey" k, at
    FROM "PipelineEvent" WHERE event='source_sync_started' AND "runId" IN (${inRuns})),
  b AS (SELECT DISTINCT ON ("runId","sourceKey") "runId" r, "sourceKey" k, ("executionBudget"->>'startedAt')::timestamptz AT TIME ZONE 'UTC' AS debut
    FROM "CaptureBatch" WHERE purpose='JOBS' AND "runId" IN (${inRuns}) AND "executionBudget" ? 'softTimeoutMs'
    ORDER BY "runId","sourceKey",("executionBudget"->>'startedAt'))
  SELECT st.r AS "runId", count(*) AS sources,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM b.debut - st.at)*1000)::numeric) AS p50_ms,
    round(percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM b.debut - st.at)*1000)::numeric) AS p90_ms
  FROM st JOIN b USING (r,k) GROUP BY 1 ORDER BY 1`);

if (runs.length >= 2) {
  const [a, b] = runs.slice(-2);
  query(`6. Top 15 des écarts de durée par source (${a} contre ${b})`, `WITH s AS (SELECT e."runId" r, e."sourceKey" k,
      (e.payload->>'durationMs')::bigint/1000 AS dur, (e.payload->'stats'->0->>'upsertMs')::bigint AS ups,
      coalesce((e.payload->'stats'->0->>'created')::int,0)+coalesce((e.payload->'stats'->0->>'updated')::int,0)+coalesce((e.payload->'stats'->0->>'merged')::int,0) AS w
      FROM "PipelineEvent" e WHERE e.event='source_sync_completed' AND e."runId" IN ('${a}','${b}'))
    SELECT x.k AS source, x.dur AS duree_a_s, y.dur AS duree_b_s, x.dur - y.dur AS ecart_s,
      round(x.ups::numeric/nullif(x.w,0)) AS ms_offre_a, round(y.ups::numeric/nullif(y.w,0)) AS ms_offre_b
    FROM s x JOIN s y ON x.k=y.k AND x.r='${a}' AND y.r='${b}' ORDER BY abs(x.dur - y.dur) DESC LIMIT 15`);
}
