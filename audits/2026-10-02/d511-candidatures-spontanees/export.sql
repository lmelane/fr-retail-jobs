-- D-511 — export en lecture seule des représentations PUBLIQUES (ce que le site montre), une ligne JSON par publication
-- disponible : l'intitulé de la source et celui de l'offre, le type natif, l'état de la source. Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -At -f <ce fichier>' > publiques.jsonl
SET statement_timeout = '120s';
SELECT json_build_object(
  'jobId', j.id, 'sourceKey', s."sourceKey", 'externalId', s."externalId", 'sourceStatus', src.status,
  'sourceTitle', s.title, 'jobTitle', j.title, 'rawTitle', j."rawTitle", 'opportunityType', j."opportunityType",
  'url', s.url, 'company', c.name,
  'availableSources', (SELECT count(*) FROM "JobSource" o WHERE o."jobId" = j.id AND o."isActive" AND (o."expiresAt" IS NULL OR o."expiresAt" > now()))
)
FROM "Job" j
JOIN "JobSource" s ON s."jobId" = j.id
JOIN "Source" src ON src.key = s."sourceKey"
JOIN "Company" c ON c.id = j."companyId"
WHERE j."isActive" AND j."mergedIntoId" IS NULL AND s."isActive" AND (s."expiresAt" IS NULL OR s."expiresAt" > now());
