-- Sources en vol et événements écrits autour des deux expirations de transaction du RUN du 01/10/2026 (lecture seule).
\pset pager off
WITH r AS (SELECT id FROM "PipelineRun" WHERE command='ingest-all' AND "startedAt" >= date_trunc('day', now()) + interval '15 hours 50 minutes' ORDER BY "startedAt" DESC LIMIT 1),
bornes AS (
  SELECT e."sourceKey", min(e.at) FILTER (WHERE e.event='source_sync_started') debut,
         max(e.at) FILTER (WHERE e.event IN ('source_sync_completed','source.failed')) fin
  FROM "PipelineEvent" e, r WHERE e."runId"=r.id GROUP BY 1),
instants(t, quoi) AS (VALUES (timestamp '2026-10-01 16:14:39', 'browns-shoes'), (timestamp '2026-10-01 16:25:55', 'diptyque-workday'), (timestamp '2026-10-01 16:40:00', 'témoin 16:40'), (timestamp '2026-10-01 17:30:00', 'témoin 17:30'))
SELECT quoi, t, (SELECT count(*) FROM bornes b WHERE b.debut <= i.t AND coalesce(b.fin, 'infinity') >= i.t) en_vol,
  (SELECT string_agg(b."sourceKey", ', ' ORDER BY b.debut) FROM bornes b WHERE b.debut <= i.t AND coalesce(b.fin, 'infinity') >= i.t) sources
FROM instants i;
SELECT to_char(date_trunc('minute', e.at),'HH24:MI') AS mn, count(*) evenements, count(*) FILTER (WHERE e.event LIKE 'job.%') job_events
FROM "PipelineEvent" e, r WHERE e."runId"=r.id AND e.at BETWEEN '2026-10-01 16:10' AND '2026-10-01 16:30' GROUP BY 1 ORDER BY 1;
