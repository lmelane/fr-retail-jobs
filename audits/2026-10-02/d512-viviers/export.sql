-- D-512 — export en lecture seule des représentations PUBLIQUES (ce que le site montre) dont un intitulé contient un
-- mot qui peut porter un libellé de vivier (talent, futur, interest, vivier, bolsa) : un SUR-ENSEMBLE des libellés de la
-- règle, filtré par la base pour que la requête reste légère. Une ligne JSON par publication disponible, mêmes champs que
-- l'export de D-511. Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -f <ce fichier>' > viviers.jsonl
SET statement_timeout = '60s';
SELECT json_build_object(
  'jobId', j.id, 'sourceKey', s."sourceKey", 'externalId', s."externalId", 'sourceStatus', src.status,
  'sourceTitle', s.title, 'jobTitle', j.title, 'rawTitle', j."rawTitle", 'opportunityType', j."opportunityType",
  'url', s.url, 'company', c.name, 'location', j.location, 'city', j.city, 'countryCode', j."countryCode",
  'availableSources', (SELECT count(*) FROM "JobSource" o WHERE o."jobId" = j.id AND o."isActive" AND (o."expiresAt" IS NULL OR o."expiresAt" > now()))
)
FROM "Job" j
JOIN "JobSource" s ON s."jobId" = j.id
JOIN "Source" src ON src.key = s."sourceKey"
JOIN "Company" c ON c.id = j."companyId"
WHERE j."isActive" AND j."mergedIntoId" IS NULL AND s."isActive" AND (s."expiresAt" IS NULL OR s."expiresAt" > now())
  AND concat_ws(' ', s.title, j.title, j."rawTitle") ~* '(talent|futur|interest|vivier|bolsa)';
