-- D-520, classes « liste non prouvée », « régression de volume », « qualification rejetée » : le détail de chaque
-- occurrence (source × RUN) des 8 RUN ingest-all du 24/09 au 01/10. LECTURE SEULE, hors fenêtre du RUN (avant 15:30
-- ou après 18:30 UTC). Rejouable depuis ce worktree :
--   CATWALKS_DB_ACCESS=<checkout>/backups/remediation-20260908 python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
--     'psql "$DATABASE_URL" -XA -v ON_ERROR_STOP=1 -f audits/2026-10-02/classes-listes-lecteurs/detail.sql' \
--     > audits/2026-10-02/classes-listes-lecteurs/detail.csv
-- Une ligne par issue classée (event source.issue_classified) des codes ENUMERATION_*, SOURCE_HEALTH_REGRESSION,
-- NATIVE_RETENTION_JUMP, *COVERAGE*, ou d'un échec de qualification (CAPTURE_NOT_VALIDATED, Admission/Validation gate),
-- avec : la famille d'adaptateur (Source.kind), le SourceRun du même RUN (lu, accepté, total déclaré, tronqué,
-- complet, peut attester l'absence, note), le SourceRun complet précédent, et le message d'échec du même RUN.
\pset footer off
\pset format csv
SET statement_timeout = '120s';
SET default_transaction_read_only = on;
WITH runs AS (
  SELECT id, "startedAt" FROM "PipelineRun" WHERE command = 'ingest-all' AND "startedAt" >= '2026-09-24' AND "startedAt" < '2026-10-02'),
iss AS (
  SELECT r.id run, r."startedAt", e."sourceKey" src, i->>'code' code, i->>'detail' detail, (i->>'count')::int n, i AS raw
  FROM runs r JOIN "PipelineEvent" e ON e."runId" = r.id AND e.event = 'source.issue_classified'
  CROSS JOIN LATERAL jsonb_array_elements(e.payload->'issues') i),
fails AS (
  SELECT DISTINCT ON (e."runId", e."sourceKey") e."runId" run, e."sourceKey" src, e.event,
         coalesce(e.payload#>>'{details,0,error,code}', e.payload#>>'{error,code}', '') ecode,
         coalesce(e.payload#>>'{details,0,error,name}', e.payload#>>'{error,name}', '') ename,
         left(coalesce(e.payload#>>'{details,0,error,message}', e.payload#>>'{error,message}', e.payload->>'message', ''), 600) msg
  FROM "PipelineEvent" e JOIN runs r ON r.id = e."runId"
  WHERE e.event IN ('source.ingest_failed', 'source.failed', 'source.timed_out', 'source.challenged') AND e."sourceKey" IS NOT NULL
  ORDER BY e."runId", e."sourceKey", (e.event = 'source.ingest_failed') DESC, e.at)
SELECT i.run, i."startedAt"::date jour, i.src, s.kind, s.status src_status, i.code, i.detail, i.n,
       sr.status sr_status, sr.jobs, sr."previousJobs", sr.fetched, sr.accepted, sr."declaredTotal", sr.truncated,
       sr.complete, sr."canAttestAbsence", left(sr.note, 400) note,
       f.event fail_event, f.ecode, f.ename, f.msg, left(i.raw::text, 600) raw,
       (SELECT max(jobs) FROM "SourceRun" x WHERE x."sourceKey" = i.src AND x."ranAt" >= '2026-09-22') max_jobs
FROM iss i
JOIN "Source" s ON s.key = i.src
LEFT JOIN LATERAL (SELECT * FROM "SourceRun" x WHERE x."runId" = i.run AND x."sourceKey" = i.src ORDER BY x."ranAt" DESC LIMIT 1) sr ON true
LEFT JOIN fails f ON f.run = i.run AND f.src = i.src
WHERE i.code IN ('ENUMERATION_NOT_PROVEN', 'ENUMERATION_REFUTED', 'SOURCE_HEALTH_REGRESSION', 'NATIVE_RETENTION_JUMP')
   OR i.code LIKE '%COVERAGE%'
   OR f.ecode = 'CAPTURE_NOT_VALIDATED' OR f.msg LIKE 'Access qualification requires validated%'
   OR f.ename IN ('SourceAdmissionGateError', 'SourceValidationGateError')
ORDER BY i."startedAt", i.src, i.code;
