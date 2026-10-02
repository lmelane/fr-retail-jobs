-- R-143 §5 — extraction en LECTURE SEULE des employeurs, 02/10/2026 : exactement la requête de
-- `employerSnapshot` (apps/aggregator/src/identity/maisonPlan.ts), une ligne JSON par Company non fusionnée.
-- Rejouer (jamais entre 15:30 et 18:30 UTC) :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -t -q -f -' < extraction-employeurs.sql > employeurs.jsonl
SET statement_timeout = '240s';
WITH servie AS (SELECT j."companyId", count(*)::int n FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL
  AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now())) GROUP BY 1),
obs AS (SELECT e."canonicalEmployerId" id, json_agg(json_build_object('sourceKey', e."sourceKey", 'maison', so.maison, 'portalScope', so."portalScope") ORDER BY e."sourceKey") sources
  FROM (SELECT DISTINCT "canonicalEmployerId", "sourceKey" FROM "EmployerObservation" WHERE "canonicalEmployerId" IS NOT NULL) e
  JOIN "Source" so ON so.key = e."sourceKey" GROUP BY 1)
SELECT json_build_object('id', c.id, 'name', c.name, 'kind', c.kind::text, 'parentGroupId', c."parentGroupId", 'servies', coalesce(s.n, 0),
  'sources', coalesce(o.sources, '[]'::json),
  'evidenceUrl', (SELECT j.url FROM "Job" j WHERE j."companyId" = c.id AND j.url LIKE 'https://%' ORDER BY j."isActive" DESC, j."lastSeenAt" DESC LIMIT 1))
FROM "Company" c LEFT JOIN servie s ON s."companyId" = c.id LEFT JOIN obs o ON o.id = c.id
WHERE c."mergedIntoId" IS NULL ORDER BY c.id;
