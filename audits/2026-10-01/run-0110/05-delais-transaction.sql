-- Expirations de transaction (P2028 / « expired transaction ») par RUN ingest-all, 6 jours (lecture seule).
\pset pager off
SELECT to_char(r."startedAt",'MM-DD') run, e."sourceKey", to_char(e.at,'HH24:MI:SS') t, e.event,
  substring(e.payload::text from 'however ([0-9]+) ms passed') AS ms_passes,
  substring(e.payload::text from 'at (async [A-Za-z_.$]+ \(/repo/apps/aggregator/src/[a-zA-Z/]+\.ts:[0-9]+)') AS lieu
FROM "PipelineRun" r JOIN "PipelineEvent" e ON e."runId"=r.id
WHERE r.command='ingest-all' AND r."startedAt" >= now() - interval '6 days 3 hours'
  AND e.level='error' AND e.payload::text LIKE '%expired transaction%'
ORDER BY e.at;
