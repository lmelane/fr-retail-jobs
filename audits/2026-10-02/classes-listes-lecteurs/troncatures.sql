-- D-520 : pour chaque collecte « troncature » des 8 RUN (SourceRun.truncated), les événements du journal de la même
-- source et du même run qui nomment la terminaison ou les motifs de parcours. LECTURE SEULE, hors fenêtre du RUN.
\pset footer off
\pset format csv
SET statement_timeout = '120s';
SET default_transaction_read_only = on;
SELECT sr."sourceKey", sr."ranAt", e.event, left(e.payload::text, 700) payload
FROM "SourceRun" sr JOIN "PipelineRun" r ON r.id = sr."runId" AND r.command = 'ingest-all'
JOIN "PipelineEvent" e ON e."runId" = sr."runId" AND e."sourceKey" = sr."sourceKey"
WHERE sr.truncated AND sr."ranAt" >= '2026-09-24'
  AND e.event NOT IN ('source_sync_started', 'source.access_qualification_started', 'source.issue_classified')
ORDER BY sr."sourceKey", sr."ranAt", e.at;
