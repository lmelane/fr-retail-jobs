-- Canonisation du secteur (D-519, D-515 §1) — état en LECTURE SEULE, 02/10/2026.
-- Le secteur d'une offre agrégée est celui de sa société (`Company.sectorCodes`, lu par
-- apps/api/lib/job-search-query.ts et search-model.ts) ; vide = « unclassified ».
-- Rejouer (jamais entre 15:30 et 18:30 UTC) :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F"	" -f -' < etat-secteur.sql
SET statement_timeout = '240s';
\echo '== 1. offres servies, secteur connu / inconnu'
WITH servie AS (SELECT j.id, j."companyId", j."countryCode" FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL
  AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now())))
SELECT count(*) servies, count(*) FILTER (WHERE cardinality(c."sectorCodes") = 0) secteur_inconnu,
  count(*) FILTER (WHERE c."mergedIntoId" IS NOT NULL) societe_fusionnee,
  count(DISTINCT s."companyId") societes, count(DISTINCT s."companyId") FILTER (WHERE cardinality(c."sectorCodes") = 0) societes_sans_secteur
FROM servie s JOIN "Company" c ON c.id = s."companyId";
\echo '== 2. par marché'
WITH servie AS (SELECT j.id, j."companyId", j."countryCode" FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL
  AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now())))
SELECT coalesce(s."countryCode", '??') marche, count(*) servies, count(*) FILTER (WHERE cardinality(c."sectorCodes") = 0) inconnu,
  round(100.0 * count(*) FILTER (WHERE cardinality(c."sectorCodes") > 0) / count(*), 1) couverture_pct
FROM servie s JOIN "Company" c ON c.id = s."companyId" GROUP BY 1 ORDER BY 2 DESC;
\echo '== 3. par secteur (une offre compte dans chacun de ses secteurs)'
WITH servie AS (SELECT j.id, j."companyId", j."countryCode" FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL
  AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now())))
SELECT x code, count(*) servies, count(*) FILTER (WHERE s."countryCode" = 'US') us
FROM servie s JOIN "Company" c ON c.id = s."companyId", unnest(c."sectorCodes") x GROUP BY 1 ORDER BY 2 DESC;
\echo '== 4. sociétés qualifiées et preuves'
SELECT count(*) FILTER (WHERE cardinality("sectorCodes") > 0) qualifiees, count(*) FILTER (WHERE "mergedIntoId" IS NULL) non_fusionnees,
  count(*) FILTER (WHERE cardinality("sectorCodes") > 0 AND "mergedIntoId" IS NOT NULL) qualifiees_fusionnees FROM "Company";
SELECT e->>'basis' basis, e->>'confidence' confiance, coalesce(e->'provenance'->>'method', '-') methode, count(*) preuves, count(DISTINCT c.id) societes
FROM "Company" c, jsonb_array_elements(CASE WHEN jsonb_typeof(c."sectorEvidence") = 'array' THEN c."sectorEvidence" ELSE '[]'::jsonb END) e
GROUP BY 1, 2, 3 ORDER BY 4 DESC;
SELECT id, reviewer, "createdAt", jsonb_array_length(manifest->'companies') societes FROM "SectorReview" ORDER BY "createdAt";
\echo '== 5. concepts'
SELECT code, slug, position FROM "SectorConcept" ORDER BY position;
