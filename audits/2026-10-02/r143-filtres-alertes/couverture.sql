-- R-143 §6 — couverture de la reconnaissance (contrat, séniorité, rôle de l'intitulé, temps de travail) sur les offres SERVIES,
-- par marché et par fournisseur. LECTURE SEULE. Jamais entre 15:30 et 18:30 UTC (RUN quotidien).
-- Rejouer (depuis le checkout de référence, qui porte les accès) :
--   cd ~/Downloads/catwalks-job-aggregator && python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F"	" -f -' < audits/2026-10-02/r143-filtres-alertes/couverture.sql
-- « Servie » = publicJobSql (packages/db/availability.ts) ET un pays de marché (packages/db/marches.ts) : ce que la recherche peut rendre.
-- contrat = "employmentTerm" ; contrat_ou_dispositif = la facette « contrat » unifiée des 41 marchés (employmentTerm, programType,
-- engagementType FREELANCE / INDEPENDENT_CONTRACTOR, `choixContrat` de apps/api/lib/job-search-query.ts).
SET statement_timeout = '120s';
-- Le corpus servi, en variable psql (une transaction en lecture seule refuse CREATE TEMP TABLE).
\set servie 'SELECT j.id, j."countryCode", j."canonicalSourceKey", j."employmentTerm", j."programType", j."engagementType", j."workTime", j.seniority, j."titleRoles", j."rawContract", j.title, CASE WHEN j."countryCode" IN (''FR'',''MC'') THEN ''FR'' WHEN j."countryCode" IN (''GB'',''IE'') THEN ''GB'' WHEN j."countryCode" IN (''DE'',''AT'') THEN ''DE'' ELSE j."countryCode" END AS marche, coalesce(s.kind, ''?'') AS fournisseur FROM "Job" j LEFT JOIN "Source" s ON s.key = j."canonicalSourceKey" WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IN (''JP'',''KR'',''PT'',''MX'',''SG'',''DK'',''HK'',''PL'',''SE'',''CL'',''TR'',''TH'',''MY'',''AE'',''NO'',''TW'',''BR'',''GR'',''ZA'',''VN'',''CZ'',''PE'',''NZ'',''HU'',''SA'',''RO'',''PR'',''PH'',''LU'',''US'',''FR'',''MC'',''GB'',''IE'',''CA'',''DE'',''AT'',''IT'',''ES'',''NL'',''AU'',''CH'',''BE'',''CN'') AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now()))'


-- Q1 ensemble
SELECT 'TOTAL' AS perimetre, count(*) n,
  round(100.0 * count(*) FILTER (WHERE "employmentTerm" IS NOT NULL) / count(*), 1) contrat,
  round(100.0 * count(*) FILTER (WHERE "employmentTerm" IS NOT NULL OR "programType" IS NOT NULL OR "engagementType" IN ('FREELANCE','INDEPENDENT_CONTRACTOR')) / count(*), 1) contrat_ou_dispositif,
  round(100.0 * count(*) FILTER (WHERE "rawContract" IS NOT NULL) / count(*), 1) libelle_brut,
  round(100.0 * count(*) FILTER (WHERE "rawContract" IS NOT NULL AND "employmentTerm" IS NULL AND "programType" IS NULL AND "engagementType" IS NULL) / count(*), 1) brut_non_resolu,
  round(100.0 * count(*) FILTER (WHERE seniority IS NOT NULL) / count(*), 1) seniorite,
  round(100.0 * count(*) FILTER (WHERE cardinality("titleRoles") > 0) / count(*), 1) role_intitule,
  round(100.0 * count(*) FILTER (WHERE "workTime" IS NOT NULL) / count(*), 1) temps
FROM (:servie) servie;

-- Q2 par marché
SELECT marche, count(*) n,
  round(100.0 * count(*) FILTER (WHERE "employmentTerm" IS NOT NULL) / count(*), 1) contrat,
  round(100.0 * count(*) FILTER (WHERE "employmentTerm" IS NOT NULL OR "programType" IS NOT NULL OR "engagementType" IN ('FREELANCE','INDEPENDENT_CONTRACTOR')) / count(*), 1) contrat_ou_dispositif,
  round(100.0 * count(*) FILTER (WHERE "rawContract" IS NOT NULL AND "employmentTerm" IS NULL AND "programType" IS NULL AND "engagementType" IS NULL) / count(*), 1) brut_non_resolu,
  round(100.0 * count(*) FILTER (WHERE seniority IS NOT NULL) / count(*), 1) seniorite,
  round(100.0 * count(*) FILTER (WHERE "workTime" IS NOT NULL) / count(*), 1) temps
FROM (:servie) servie GROUP BY 1 ORDER BY 2 DESC;

-- Q3 par fournisseur (famille d'adaptateur de la source propriétaire)
SELECT fournisseur, count(*) n,
  round(100.0 * count(*) FILTER (WHERE "employmentTerm" IS NOT NULL) / count(*), 1) contrat,
  round(100.0 * count(*) FILTER (WHERE "employmentTerm" IS NOT NULL OR "programType" IS NOT NULL OR "engagementType" IN ('FREELANCE','INDEPENDENT_CONTRACTOR')) / count(*), 1) contrat_ou_dispositif,
  round(100.0 * count(*) FILTER (WHERE "rawContract" IS NOT NULL) / count(*), 1) libelle_brut,
  round(100.0 * count(*) FILTER (WHERE "rawContract" IS NOT NULL AND "employmentTerm" IS NULL AND "programType" IS NULL AND "engagementType" IS NULL) / count(*), 1) brut_non_resolu,
  round(100.0 * count(*) FILTER (WHERE seniority IS NOT NULL) / count(*), 1) seniorite,
  round(100.0 * count(*) FILTER (WHERE "workTime" IS NOT NULL) / count(*), 1) temps
FROM (:servie) servie GROUP BY 1 ORDER BY 2 DESC;

-- Q4 libellés bruts de contrat NON résolus (aucune dimension), les plus fréquents
SELECT "rawContract", count(*) n, string_agg(DISTINCT fournisseur, ',') fournisseurs
FROM (:servie) servie WHERE "rawContract" IS NOT NULL AND "employmentTerm" IS NULL AND "programType" IS NULL AND "engagementType" IS NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 80;

-- Q5 libellés bruts résolus en dispositif ou temps de travail seulement (contrat vide) : ce qui reste à lire
SELECT "rawContract", count(*) n FROM (:servie) servie WHERE "rawContract" IS NOT NULL AND "employmentTerm" IS NULL AND ("programType" IS NOT NULL OR "workTime" IS NOT NULL)
GROUP BY 1 ORDER BY 2 DESC LIMIT 40;

-- Q6 valeurs de séniorité servies
SELECT seniority, count(*) FROM (:servie) servie GROUP BY 1 ORDER BY 2 DESC;
