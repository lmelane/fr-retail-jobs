-- D-520 — recouvrement entre sources ACTIVE (lecture seule, 02/10/2026).
-- 1. paires de sources qui portent les MÊMES offres (une offre dédoublonnée, deux publications actives) ;
-- 2. Maisons (Company) servies par plusieurs sources actives.
-- Rejouable : python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -At -f <ce fichier>' > recouvrements-2026-10-02.json
WITH pub AS (
  SELECT js."jobId", js."sourceKey", j."companyId"
    FROM "JobSource" js JOIN "Source" s ON s.key = js."sourceKey" AND s.status = 'ACTIVE'
    JOIN "Job" j ON j.id = js."jobId"
   WHERE js."isActive" AND j."isActive" AND j."withdrawnAt" IS NULL
), per_source AS (
  SELECT "sourceKey", count(DISTINCT "jobId") AS jobs FROM pub GROUP BY 1
), pairs AS (
  SELECT a."sourceKey" AS a, b."sourceKey" AS b, count(DISTINCT a."jobId") AS shared
    FROM pub a JOIN pub b ON a."jobId" = b."jobId" AND a."sourceKey" < b."sourceKey"
   GROUP BY 1, 2
), maisons AS (
  SELECT c.name, c."canonicalKey", count(DISTINCT p."sourceKey") AS sources,
         json_agg(DISTINCT p."sourceKey") AS keys, count(DISTINCT p."jobId") AS jobs
    FROM pub p JOIN "Company" c ON c.id = p."companyId"
   GROUP BY c.id, c.name, c."canonicalKey" HAVING count(DISTINCT p."sourceKey") > 1
)
SELECT json_build_object(
  'sourcesWithExposedJobs', (SELECT count(*) FROM per_source),
  'exposedJobs', (SELECT count(DISTINCT "jobId") FROM pub),
  'pairs', (SELECT json_agg(row_to_json(x) ORDER BY x.shared DESC) FROM (
      SELECT p.a, p.b, p.shared, sa.jobs AS "aJobs", sb.jobs AS "bJobs"
        FROM pairs p JOIN per_source sa ON sa."sourceKey" = p.a JOIN per_source sb ON sb."sourceKey" = p.b) x),
  'maisonsMultiSources', (SELECT json_agg(row_to_json(m) ORDER BY m.jobs DESC) FROM maisons m)
);
