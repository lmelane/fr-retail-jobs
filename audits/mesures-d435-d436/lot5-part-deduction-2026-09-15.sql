-- LECTURE SEULE. LA PART DE DÉDUCTION, par marché.
-- Question : ce qu'on affiche au candidat vient-il d'un champ DÉCLARÉ par la
-- source, ou d'une déduction (regex sur l'intitulé / le texte) ?
--
-- Méthode : une offre est dite "source déclarée" pour l'expérience si `raw`
-- porte l'une des clés RÉELLEMENT ÉNUMÉRÉES (lot5-cles-raw-par-ats), sinon la
-- valeur de `seniority` ne peut venir que de l'inférence.
-- Rejouable : node audits/mesures-d435-d436/q.mjs --file <ce fichier>
WITH a AS (
  SELECT "countryCode" AS pays,
         "seniority" IS NOT NULL AS a_senior,
         "occupationCode" IS NOT NULL AS a_metier,
         (COALESCE(raw->>'experience_level_minimum', raw->>'experienceLevel', raw->>'experience_code',
                   raw->>'requiredExperience', raw->>'careerLevel', raw->>'seniority',
                   raw->>'yearsOfExperience', raw->>'experience', raw->>'experienceRequirements',
                   raw->>'grade') IS NOT NULL) AS src_exp,
         (COALESCE(raw->>'function', raw->>'department', raw->>'category', raw->>'categories',
                   raw->>'jobFamily', raw->>'occupationCategory', raw->>'career_domain',
                   raw->>'new_profession', raw->>'category_code', raw->>'departments',
                   raw->>'recruitingCategory', raw->>'functionFilter') IS NOT NULL) AS src_metier
  FROM "Job"
  WHERE "isActive" = true AND "mergedIntoId" IS NULL
    AND "countryCode" IN ('US','FR','GB','CA','DE','IT','ES','NL','AU','CH','BE','CN')
)
SELECT pays,
       count(*)::int AS n,
       count(*) FILTER (WHERE a_senior)::int AS senior_affiche,
       count(*) FILTER (WHERE a_senior AND src_exp)::int AS senior_avec_src,
       count(*) FILTER (WHERE a_senior AND NOT src_exp)::int AS senior_deduit,
       count(*) FILTER (WHERE a_metier)::int AS metier_affiche,
       count(*) FILTER (WHERE a_metier AND src_metier)::int AS metier_avec_src,
       count(*) FILTER (WHERE a_metier AND NOT src_metier)::int AS metier_deduit
FROM a
GROUP BY pays
ORDER BY n DESC
