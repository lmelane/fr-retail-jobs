-- RUN ingest-all du 01/10/2026 : tous les événements des 11 sources bloquantes (lecture seule).
\pset pager off
WITH r AS (SELECT id FROM "PipelineRun" WHERE command='ingest-all' AND "startedAt" >= date_trunc('day', now()) + interval '15 hours 50 minutes' ORDER BY "startedAt" DESC LIMIT 1)
SELECT e."sourceKey", to_char(e.at,'HH24:MI:SS') t, e.level, e.event, left(e.payload::text, 1500) AS payload
FROM "PipelineEvent" e, r
WHERE e."runId"=r.id AND e."sourceKey" IN ('browns-shoes','crocs','diptyque-workday','ganni-talentrecruiter','gemmyo','puma','richemont','sephora-france','ulta-jibe','urbn-hub','versace')
ORDER BY 1, e.at;
