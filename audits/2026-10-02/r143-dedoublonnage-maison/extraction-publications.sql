-- R-143 §4 — extraction en LECTURE SEULE des publications que les nouvelles preuves peuvent rapprocher, 02/10/2026.
-- Rejouer (jamais entre 15:30 et 18:30 UTC) :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -t -f -' \
--     < audits/2026-10-02/r143-dedoublonnage-maison/extraction-publications.sql > <scratch>/publications.jsonl
-- Une ligne JSON par JobSource ACTIVE d'une offre SERVIE (publicJobSql, packages/db/availability.ts:18). Le RAW est
-- RÉDUIT aux seuls champs que lisent les lecteurs d'identité (identity/successfactorsRequisition.ts, smartrecruiters.ts,
-- teamtailor.ts) : la mesure appelle ces fonctions telles quelles, sans réimplémentation.
SET statement_timeout = '180s';
WITH servie AS (SELECT j.id, j."companyId", j.city FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL
  AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now())))
SELECT json_build_object('jobId', s."jobId", 'companyId', v."companyId", 'sourceKey', s."sourceKey", 'sourceTier', s."sourceTier",
  'externalId', s."externalId", 'url', s.url, 'kind', so.kind, 'title', s.title, 'city', v.city, 'postedAt', s."postedAt",
  'expiresAt', s."expiresAt", 'isActive', s."isActive", 'raw', CASE
    WHEN so.kind = 'lvmh_algolia' THEN jsonb_build_object('link', s.raw->'link', 'atsId', s.raw->'atsId', 'description', s.raw->'description',
      'jobResponsabilities', s.raw->'jobResponsabilities', 'profile', s.raw->'profile', 'additionalInformation', s.raw->'additionalInformation')
    WHEN so.kind = 'successfactors' THEN jsonb_build_object('id', s.raw->'id', 'source', s.raw->'source',
      'successfactorsDetail', jsonb_build_object('description', s.raw#>'{successfactorsDetail,description}'))
    WHEN so.kind = 'teamtailor' THEN jsonb_build_object('id', s.raw->'id', 'url', s.raw->'url', '_jobposting', jsonb_build_object(
      '@type', s.raw#>'{_jobposting,@type}', 'identifier', s.raw#>'{_jobposting,identifier}', 'hiringOrganization', s.raw#>'{_jobposting,hiringOrganization}'))
    WHEN so.kind LIKE 'smartrecruiters%' THEN jsonb_build_object('id', s.raw->'id', 'ref', s.raw->'ref')
    WHEN so.kind IN ('wttj', 'wttj-sector') THEN jsonb_build_object('detail', jsonb_build_object('apply_url', s.raw#>'{detail,apply_url}'))
  END)
FROM "JobSource" s JOIN servie v ON v.id = s."jobId" JOIN "Source" so ON so.key = s."sourceKey"
WHERE s."isActive" AND (s."expiresAt" IS NULL OR s."expiresAt" > now())
  AND (so.kind IN ('teamtailor', 'wttj', 'wttj-sector') OR so.kind LIKE 'smartrecruiters%'
    OR (so.kind = 'lvmh_algolia' AND s.url LIKE 'https://career%.sapsf.%') OR (so.kind = 'successfactors' AND s.url LIKE 'https://jobs.sephora.com/%'));
