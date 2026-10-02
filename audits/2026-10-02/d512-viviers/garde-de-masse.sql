-- D-512 — le calibrage de la garde de masse : publications publiques disponibles par source, pour les sources dont des
-- viviers ou des candidatures spontanées seraient retenus (passages à blanc de D-511 et D-512). Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F "|" -v ON_ERROR_STOP=1 -f <ce fichier>'
SET statement_timeout = '30s';
SELECT s."sourceKey", count(*) AS publications
FROM "JobSource" s JOIN "Job" j ON j.id = s."jobId"
WHERE s."isActive" AND (s."expiresAt" IS NULL OR s."expiresAt" > now()) AND j."isActive" AND j."mergedIntoId" IS NULL
  AND s."sourceKey" IN ('mejuri','brown-thomas-taleo','kering','arcteryx','breitling-sf','chalhoub','hugo-boss-phenom','nutrafol','nutrire','ounass','pvh','lerros')
GROUP BY 1 ORDER BY 2;
