-- LECTURE SEULE. Taux de remplissage de CHAQUE dimension du registre, par ATS.
-- Population : offres ACTIVES non fusionnées, DANS les 12 marchés du registre.
-- Rejouable : node audits/mesures-d435-d436/q.mjs --file <ce fichier>
SELECT
  source::text AS ats,
  count(*)::int AS n,
  round(100.0 * count(*) FILTER (WHERE "employmentTerm" IS NOT NULL) / count(*), 1) AS pct_contrat,
  round(100.0 * count(*) FILTER (WHERE "workTime"       IS NOT NULL) / count(*), 1) AS pct_temps,
  round(100.0 * count(*) FILTER (WHERE "programType"    IS NOT NULL) / count(*), 1) AS pct_programme,
  round(100.0 * count(*) FILTER (WHERE "isSeasonal"     IS TRUE)     / count(*), 1) AS pct_saison,
  round(100.0 * count(*) FILTER (WHERE "occupationCode" IS NOT NULL) / count(*), 1) AS pct_metier,
  round(100.0 * count(*) FILTER (WHERE "seniority"      IS NOT NULL) / count(*), 1) AS pct_senior,
  round(100.0 * count(*) FILTER (WHERE "experienceYears" IS NOT NULL) / count(*), 1) AS pct_annees,
  round(100.0 * count(*) FILTER (WHERE "workplaceType"  IS NOT NULL) / count(*), 1) AS pct_lieu,
  round(100.0 * count(*) FILTER (WHERE "educationLevel" IS NOT NULL) / count(*), 1) AS pct_diplome,
  round(100.0 * count(*) FILTER (WHERE "salaryMin"      IS NOT NULL) / count(*), 1) AS pct_salaire
FROM "Job"
WHERE "isActive" = true AND "mergedIntoId" IS NULL
  AND "countryCode" IN ('US','FR','GB','CA','DE','IT','ES','NL','AU','CH','BE','CN')
GROUP BY source
HAVING count(*) >= 30
ORDER BY n DESC
