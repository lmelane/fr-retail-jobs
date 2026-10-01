-- STOCKAGE — 10. Quelle part du catalogue stocké est vivante (base de la projection à 10 fois). Exact, lecture seule.
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-01/stockage/10-catalogue-actif.sql'
\pset footer off
\timing on
SELECT "isActive", ("mergedIntoId" IS NOT NULL) AS absorbee, count(*) AS offres FROM "Job" GROUP BY 1, 2 ORDER BY 1, 2;
SELECT "isActive", count(*) AS publications FROM "JobSource" GROUP BY 1 ORDER BY 1;
SELECT count(DISTINCT "sourceKey") AS sources_avec_collecte_14j FROM "CaptureBatch" WHERE purpose = 'JOBS' AND "startedAt" > now() - interval '14 days';
SELECT pg_database_size(current_database()) AS octets_base_maintenant, now()::timestamp(0) AS a;
