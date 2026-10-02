-- D-520 — la cause enveloppée des « Native response capture unavailable » des RUN ingest-all depuis le 24/09.
-- LECTURE SEULE, hors fenêtre du RUN. Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
--     'psql "$DATABASE_URL" -XA -F"|" -f <worktree>/audits/2026-10-02/remediation-auto/captures-refusees.sql' > captures-refusees.out
\pset footer off
SELECT p."startedAt"::date jour, e."sourceKey", e.payload#>>'{error,cause,cause}' cause_enveloppee
FROM "PipelineEvent" e JOIN "PipelineRun" p ON p.id = e."runId"
WHERE p.command = 'ingest-all' AND p."startedAt" >= '2026-09-24' AND e.event = 'source.ingest_failed'
  AND e.payload::text LIKE '%Native response capture unavailable%'
ORDER BY 1, 2;
