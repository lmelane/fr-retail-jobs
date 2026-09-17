-- LECTURE SEULE. LE GISEMENT PERDU : la source DÉCLARE-t-elle un champ que la
-- colonne canonique laisse vide ? Clés tirées de l'énumération réelle de `raw`
-- (lot5-cles-raw-par-ats), jamais devinées.
-- Rejouable : node audits/mesures-d435-d436/q.mjs --file <ce fichier>
WITH a AS (
  SELECT source::text AS ats, "countryCode" AS pays,
         "educationLevel" IS NOT NULL AS col_diplome,
         "experienceYears" IS NOT NULL AS col_annees,
         "seniority" IS NOT NULL AS col_senior,
         -- DIPLÔME déclaré à la source, toutes graphies rencontrées
         (COALESCE(raw->>'education_level', raw->>'education', raw->>'education_code',
                   raw->>'educationLevel', raw->>'studyLevel') IS NOT NULL) AS src_diplome,
         -- EXPÉRIENCE déclarée à la source
         (COALESCE(raw->>'experience_level_minimum', raw->>'experienceLevel', raw->>'experience_code',
                   raw->>'requiredExperience', raw->>'careerLevel', raw->>'seniority',
                   raw->>'yearsOfExperience', raw->>'experience', raw->>'experienceRequirements') IS NOT NULL) AS src_exp
  FROM "Job"
  WHERE "isActive" = true AND "mergedIntoId" IS NULL
    AND raw IS NOT NULL AND jsonb_typeof(raw) = 'object'
)
SELECT ats,
       count(*)::int AS n,
       count(*) FILTER (WHERE src_diplome)::int AS src_diplome,
       count(*) FILTER (WHERE col_diplome)::int AS col_diplome,
       count(*) FILTER (WHERE src_diplome AND NOT col_diplome)::int AS diplome_perdu,
       count(*) FILTER (WHERE src_exp)::int AS src_exp,
       count(*) FILTER (WHERE col_annees)::int AS col_annees,
       count(*) FILTER (WHERE col_senior)::int AS col_senior,
       count(*) FILTER (WHERE src_exp AND NOT col_annees)::int AS exp_non_chiffree
FROM a
GROUP BY ats
HAVING count(*) >= 30
ORDER BY n DESC
