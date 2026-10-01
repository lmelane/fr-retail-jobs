-- STOCKAGE — 4. À quelle heure les blobs s'écrivent (le jour en cours est-il complet ?). Exact, lecture seule.
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-01/stockage/04-horaire-run.sql'
\pset footer off
SELECT date_trunc('hour', "createdAt")::timestamp(0) AS heure_utc, count(*) AS blobs, round(sum("gzipLength") / 1e6) AS gzip_mo
FROM "RawBlob" WHERE "createdAt" > now() - interval '50 hours' GROUP BY 1 ORDER BY 1;
SELECT "runId" IS NOT NULL AS avec_run, min("startedAt")::timestamp(0), max("startedAt")::timestamp(0), count(*)
FROM "CaptureBatch" WHERE "startedAt" > now() - interval '30 hours' AND purpose = 'JOBS' GROUP BY 1;
