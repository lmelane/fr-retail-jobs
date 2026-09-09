-- Read-only recipes. Supply run_id and event_id with psql -v (do not paste secrets).
BEGIN READ ONLY;
-- Recent runs; RUNNING without a live deployment means an interrupted run.
SELECT id, command, revision, "startedAt", "finishedAt", status, metrics
FROM "PipelineRun" ORDER BY "startedAt" DESC LIMIT 20;
-- All diagnostic occurrences, including those aggregated on stdout.
SELECT event, level, "sourceKey", "connectorId", count(*)
FROM "PipelineEvent" WHERE "runId" = :'run_id'
GROUP BY event, level, "sourceKey", "connectorId" ORDER BY count(*) DESC;
-- Retrieve the complete, redacted payload by the eventId shown in Railway.
SELECT id, "runId", at, level, event, "sourceKey", "connectorId", "jobId", payload
FROM "PipelineEvent" WHERE id = :'event_id';
-- Reconcile declared event count with what really exists.
SELECT r.id, r.status, (r.metrics->>'recorded')::bigint AS recorded,
 (SELECT count(*) FROM "PipelineEvent" e WHERE e."runId" = r.id) AS actual
FROM "PipelineRun" r WHERE r.id = :'run_id';
SELECT "sourceKey", status, jobs, errors, "canAttestAbsence", note
FROM "SourceRun" WHERE "runId" = :'run_id' ORDER BY "sourceKey";
COMMIT;
