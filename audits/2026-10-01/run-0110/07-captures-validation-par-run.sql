-- Captures de validation natives et requalifications par RUN ingest-all (lecture seule).
\pset pager off
SELECT to_char(r."startedAt",'MM-DD') run, left(r.revision,7) rev, e.event, coalesce(e.payload->>'reason','') reason, count(*)
FROM "PipelineRun" r JOIN "PipelineEvent" e ON e."runId"=r.id
WHERE r.command='ingest-all' AND r."startedAt" >= now() - interval '6 days 3 hours'
  AND e.event IN ('source.native_qualification_started','source.native_qualification_completed','source.access_qualification_started','source.access_scope_outgrown','source.access_scope_check_failed')
GROUP BY 1,2,3,4 ORDER BY 1,3,4;
