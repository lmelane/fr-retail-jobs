-- D-512 — le dénominateur : publications publiques disponibles et offres distinctes, à l'heure de l'export. Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F "|" -v ON_ERROR_STOP=1 -f <ce fichier>'
SET statement_timeout = '60s';
SELECT count(*) AS publications, count(DISTINCT j.id) AS offres
FROM "Job" j JOIN "JobSource" s ON s."jobId" = j.id
WHERE j."isActive" AND j."mergedIntoId" IS NULL AND s."isActive" AND (s."expiresAt" IS NULL OR s."expiresAt" > now());
