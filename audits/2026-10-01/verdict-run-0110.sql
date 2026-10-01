-- Verdict du RUN ingest-all du 01/10/2026 (lecture seule) : sources dont l'issue n'est ni native prouvée ni échec connu.
\pset footer off
WITH r AS (SELECT id, status, "startedAt", "finishedAt" FROM "PipelineRun" WHERE command='ingest-all' AND "startedAt" >= date_trunc('day', now()) + interval '15 hours 50 minutes' ORDER BY "startedAt" DESC LIMIT 1)
SELECT r.status, to_char(r."startedAt",'HH24:MI') debut, to_char(r."finishedAt",'HH24:MI') fin,
  (SELECT count(*) FROM "PipelineEvent" e WHERE e."runId"=r.id AND e.event='source_sync_completed') AS sources_terminees,
  (SELECT count(DISTINCT e."sourceKey") FROM "PipelineEvent" e WHERE e."runId"=r.id AND e.event='source.issue_classified') AS sources_avec_issue,
  (SELECT count(DISTINCT e."sourceKey") FROM "PipelineEvent" e WHERE e."runId"=r.id AND e.event='source.issue_classified'
     AND coalesce((e.payload->>'acceptedNativeOnly')::boolean,false)=false AND coalesce((e.payload->>'knownFailure')::boolean,false)=false) AS bloquantes
FROM r;
WITH r AS (SELECT id FROM "PipelineRun" WHERE command='ingest-all' AND "startedAt" >= date_trunc('day', now()) + interval '15 hours 50 minutes' ORDER BY "startedAt" DESC LIMIT 1)
SELECT e."sourceKey", string_agg(DISTINCT (i->>'origin')||'/'||(i->>'code'), ', ') AS issues
FROM "PipelineEvent" e, r, jsonb_array_elements(e.payload->'issues') i
WHERE e."runId"=r.id AND e.event='source.issue_classified'
  AND coalesce((e.payload->>'acceptedNativeOnly')::boolean,false)=false AND coalesce((e.payload->>'knownFailure')::boolean,false)=false
GROUP BY 1 ORDER BY 1;
