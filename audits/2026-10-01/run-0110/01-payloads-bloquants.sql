-- RUN ingest-all du 01/10/2026 : payload complet des événements source.issue_classified bloquants (lecture seule).
\pset pager off
WITH r AS (SELECT id FROM "PipelineRun" WHERE command='ingest-all' AND "startedAt" >= date_trunc('day', now()) + interval '15 hours 50 minutes' ORDER BY "startedAt" DESC LIMIT 1)
SELECT e."sourceKey", e.at, jsonb_pretty(e.payload) AS payload
FROM "PipelineEvent" e, r
WHERE e."runId"=r.id AND e.event='source.issue_classified'
  AND coalesce((e.payload->>'acceptedNativeOnly')::boolean,false)=false AND coalesce((e.payload->>'knownFailure')::boolean,false)=false
ORDER BY 1;
