-- Sources bloquantes de chaque RUN ingest-all depuis le 29/09 (même règle que le verdict, lecture seule).
\pset pager off
SELECT to_char(r."startedAt",'MM-DD') run, e."sourceKey", string_agg(DISTINCT (i->>'origin')||'/'||(i->>'code'), ', ') issues
FROM "PipelineRun" r JOIN "PipelineEvent" e ON e."runId"=r.id, jsonb_array_elements(e.payload->'issues') i
WHERE r.command='ingest-all' AND r."startedAt" >= '2026-09-30' AND e.event='source.issue_classified'
  AND coalesce((e.payload->>'acceptedNativeOnly')::boolean,false)=false AND coalesce((e.payload->>'knownFailure')::boolean,false)=false
GROUP BY 1,2 ORDER BY 1,2;
