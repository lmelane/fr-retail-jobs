-- Refus d'identité d'employeur par motif et par RUN ingest-all, 7 jours (lecture seule).
\pset pager off
SELECT to_char(r."startedAt",'MM-DD') run, e.payload->'error'->>'motif' motif, e."sourceKey",
  count(*) refus, string_agg(DISTINCT (e.payload->'error'->>'rawEmployerName')||' → '||(e.payload->'error'->>'proposedName'), ' ; ') exemples
FROM "PipelineRun" r JOIN "PipelineEvent" e ON e."runId"=r.id
WHERE r.command='ingest-all' AND r."startedAt" >= now() - interval '7 days 3 hours' AND e.event='job.write_failed'
  AND e.payload->'error'->>'name'='EmployerIdentityReviewRequired'
  AND e.payload->'error'->>'motif' IN ('EMPLOYER_SPELLING_DIVERGED','EMPLOYER_TARGET_MISMATCH')
GROUP BY 1,2,3 ORDER BY 1,2,3;
