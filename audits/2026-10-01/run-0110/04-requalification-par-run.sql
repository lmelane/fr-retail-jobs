-- Requalifications d'accès et verdict par RUN ingest-all (6 derniers jours, lecture seule).
\pset pager off
SELECT r.id, r.revision, to_char(r."startedAt",'MM-DD HH24:MI') debut, to_char(r."finishedAt",'HH24:MI') fin, r.status,
  count(*) FILTER (WHERE e.event='source.access_qualification_started') AS qualif_demarrees,
  count(*) FILTER (WHERE e.event='source.access_qualification_completed') AS qualif_terminees,
  count(*) FILTER (WHERE e.event='source.access_qualification_completed' AND e.payload->>'reason'='ACCESS_STALE') AS stale,
  count(*) FILTER (WHERE e.event='source.access_qualification_completed' AND e.payload->>'reason'<>'ACCESS_STALE') AS autre_raison,
  count(DISTINCT e."sourceKey") FILTER (WHERE e.event='source.issue_classified' AND coalesce((e.payload->>'acceptedNativeOnly')::boolean,false)=false AND coalesce((e.payload->>'knownFailure')::boolean,false)=false) AS bloquantes
FROM "PipelineRun" r JOIN "PipelineEvent" e ON e."runId"=r.id
WHERE r.command='ingest-all' AND r."startedAt" >= now() - interval '6 days 3 hours'
GROUP BY 1,2,3,4,5 ORDER BY r."startedAt";
-- Raisons de qualification du RUN du jour
WITH r AS (SELECT id FROM "PipelineRun" WHERE command='ingest-all' AND "startedAt" >= date_trunc('day', now()) + interval '15 hours 50 minutes' ORDER BY "startedAt" DESC LIMIT 1)
SELECT e.payload->>'reason' reason, e.payload->>'verdict' verdict, count(*) FROM "PipelineEvent" e, r WHERE e."runId"=r.id AND e.event='source.access_qualification_completed' GROUP BY 1,2 ORDER BY 3 DESC;
