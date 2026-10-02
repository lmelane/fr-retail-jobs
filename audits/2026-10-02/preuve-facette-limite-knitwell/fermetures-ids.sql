-- Les identifiants des représentations de knitwell désactivées sur preuve depuis le 23/09 et toujours inactives (lecture
-- seule) ; partagées ensuite contre `liste-knitwell.json` par `partage.py`.
\pset footer off
SET statement_timeout = '120s';
SET default_transaction_read_only = on;
WITH deact AS (
  SELECT DISTINCT ON (d.id) d.id, dc."createdAt" AS at FROM "DataCorrection" dc
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(dc.evidence->'deactivatedIds') = 'array'
    THEN dc.evidence->'deactivatedIds' ELSE '[]'::jsonb END) AS d(id)
  WHERE dc.finding = 'REFRESH_LIFECYCLE' AND dc.evidence->>'outcome' = 'APPLIED' AND dc."createdAt" >= '2026-09-23'
  ORDER BY d.id, dc."createdAt" DESC)
SELECT s."externalId", to_char(x.at, 'YYYY-MM-DD') deactivated, j."isActive" job_active
FROM deact x JOIN "JobSource" s ON s.id = x.id LEFT JOIN "Job" j ON j.id = s."jobId"
WHERE s."sourceKey" = 'knitwell-us-retail' AND NOT s."isActive" ORDER BY 1;
