-- Issues non bloquantes du RUN du 01/10/2026 : natives prouvées ou échecs connus (lecture seule).
\pset pager off
WITH r AS (SELECT id FROM "PipelineRun" WHERE command='ingest-all' AND "startedAt" >= '2026-10-01 15:50' ORDER BY "startedAt" DESC LIMIT 1)
SELECT e."sourceKey", coalesce(e.payload->>'acceptedNativeOnly','') natif, coalesce(e.payload->>'knownFailure','') connu,
  string_agg(DISTINCT (i->>'origin')||'/'||(i->>'code'), ', ') issues
FROM "PipelineEvent" e, r, jsonb_array_elements(e.payload->'issues') i
WHERE e."runId"=r.id AND e.event='source.issue_classified'
  AND (coalesce((e.payload->>'acceptedNativeOnly')::boolean,false) OR coalesce((e.payload->>'knownFailure')::boolean,false))
GROUP BY 1,2,3 ORDER BY 4,1;
