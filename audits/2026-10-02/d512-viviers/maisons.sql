-- D-512 — les Maisons des offres retirées à blanc : offres publiques disponibles de chacune, pour voir si un retrait vide
-- une Maison de toutes ses offres. Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F "|" -v ON_ERROR_STOP=1 -f <ce fichier>'
SET statement_timeout = '30s';
SELECT c.name, count(DISTINCT j.id) AS offres
FROM "Job" j JOIN "Company" c ON c.id = j."companyId" JOIN "JobSource" s ON s."jobId" = j.id
WHERE j."isActive" AND j."mergedIntoId" IS NULL AND s."isActive" AND (s."expiresAt" IS NULL OR s."expiresAt" > now())
  AND c.name IN ('Mejuri', 'Brioni', 'HUGO BOSS Textile Ind. Ltd.', 'Nutrafol', 'PVH')
GROUP BY 1 ORDER BY 1;
