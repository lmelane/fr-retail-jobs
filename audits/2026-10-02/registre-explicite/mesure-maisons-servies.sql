-- D-520 — Maisons servies et sources actives sans offre servie (lecture seule, 02/10/2026).
WITH pub AS (
  SELECT js."sourceKey", j."companyId", c.name
    FROM "JobSource" js JOIN "Source" s ON s.key = js."sourceKey" AND s.status = 'ACTIVE'
    JOIN "Job" j ON j.id = js."jobId" JOIN "Company" c ON c.id = j."companyId"
   WHERE js."isActive" AND j."isActive" AND j."withdrawnAt" IS NULL
)
SELECT json_build_object(
  'companiesServed', (SELECT count(DISTINCT "companyId") FROM pub),
  'activeSourcesWithoutServedJob', (SELECT json_agg(json_build_object('key', s.key, 'maison', s.maison, 'lastRunStatus', s."lastRunStatus", 'lastRunJobs', s."lastRunJobs"))
      FROM "Source" s WHERE s.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM pub WHERE pub."sourceKey" = s.key)),
  'miuMiuServedBy', (SELECT json_agg(DISTINCT "sourceKey") FROM pub WHERE name ILIKE '%miu miu%')
);
