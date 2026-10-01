-- Vitesse d'écriture (upsertMs par offre écrite) et durée de qualification par RUN, par tranche de 15 min (lecture seule).
\pset pager off
WITH s AS (
  SELECT r."startedAt"::date d, date_trunc('hour', e.at) + floor(extract(minute from e.at)/15)*interval '15 min' q,
         (st->>'upsertMs')::numeric ums, (coalesce((st->>'created')::int,0)+coalesce((st->>'updated')::int,0)) n
  FROM "PipelineRun" r JOIN "PipelineEvent" e ON e."runId"=r.id, jsonb_array_elements(e.payload->'stats') st
  WHERE r.command='ingest-all' AND r."startedAt" >= now() - interval '3 days 3 hours' AND e.event='source_sync_completed'
)
SELECT d, to_char(q,'HH24:MI') q, count(*) sources, sum(n) offres, round(sum(ums)/nullif(sum(n),0),1) ms_par_offre
FROM s WHERE n>0 GROUP BY 1,2 ORDER BY 1,2;
