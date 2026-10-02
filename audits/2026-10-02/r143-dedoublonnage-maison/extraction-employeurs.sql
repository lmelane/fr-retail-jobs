-- R-143 §5 — extraction en LECTURE SEULE des employeurs, 02/10/2026 : exactement `EMPLOYER_SNAPSHOT_SQL`
-- (apps/aggregator/src/identity/maisonPlan.ts), une ligne JSON par Company non fusionnée.
-- Rejouer (jamais entre 15:30 et 18:30 UTC) :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -t -q -f -' < extraction-employeurs.sql > employeurs.jsonl
SET statement_timeout = '240s';
SELECT row_to_json(x) FROM (
WITH servie AS (SELECT j."companyId", count(*)::int n FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL
      AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now())) GROUP BY 1),
    toutes AS (SELECT "companyId", count(*)::int n FROM "Job" GROUP BY 1),
    seen AS (SELECT DISTINCT coalesce(ec."mergedIntoId", ec.id) id, e."sourceKey", e."rawEmployerName" label
      FROM "EmployerObservation" e JOIN "Company" ec ON ec.id = e."canonicalEmployerId"),
    obs AS (SELECT s.id, json_agg(DISTINCT jsonb_build_object('sourceKey', s."sourceKey", 'maison', so.maison, 'portalScope', so."portalScope")) sources,
      json_agg(DISTINCT jsonb_build_object('sourceKey', s."sourceKey", 'label', s.label)) labels
      FROM seen s JOIN "Source" so ON so.key = s."sourceKey" GROUP BY 1)
    SELECT c.id, c.name, c.kind::text kind, c."parentGroupId", c."parentGroup", c.domain, c."sectorCodes", c."fashionjobsUrl",
      coalesce(s.n, 0) servies, coalesce(t.n, 0) toutes, coalesce(o.sources, '[]'::json) sources, coalesce(o.labels, '[]'::json) labels,
      (SELECT j.url FROM "Job" j WHERE j."companyId" = c.id AND j.url LIKE 'https://%' ORDER BY j."isActive" DESC, j."lastSeenAt" DESC LIMIT 1) "evidenceUrl"
    FROM "Company" c LEFT JOIN servie s ON s."companyId" = c.id LEFT JOIN toutes t ON t."companyId" = c.id LEFT JOIN obs o ON o.id = c.id
    WHERE c."mergedIntoId" IS NULL ORDER BY c.id
) x;
