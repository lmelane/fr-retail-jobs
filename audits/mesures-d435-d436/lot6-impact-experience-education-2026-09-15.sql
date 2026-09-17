-- LOT 6 — IMPACT MESURÉ de la lecture de l'expérience et du niveau d'études.
--
-- LECTURE SEULE. Rejouable via :
--   POSTGRES_PASSWORD=… node audits/mesures-d435-d436/q.mjs \
--     --file audits/mesures-d435-d436/lot6-impact-experience-education-2026-09-15.sql
--
-- Simule, sur les offres ACTIVES, ce que les mappings du lot écriraient, et
-- compare la couverture par marché au SEUIL_AFFICHAGE_FACETTE (0.2) de
-- packages/db/marches.ts. Ne modifie rien : la colonne reste à remplir par un
-- ré-ingest.
--
-- Les conversions reproduites ici sont EXACTEMENT celles de
-- apps/aggregator/src/normalize/experience.ts. Les rangs de séniorité
-- (SmartRecruiters, Recruitee.experience_code, Workable.experience,
-- Personio.seniority) sont volontairement ABSENTS : ils ne se convertissent pas
-- en durée, et les compter ici surestimerait l'impact.

WITH simule AS (
  SELECT
    j."countryCode" AS marche,
    -- EXPÉRIENCE, en années.
    CASE
      -- LVMH : forme canonique uniquement, jamais le libellé traduit.
      WHEN j.source = 'LVMH_ALGOLIA' THEN
        CASE nullif(trim(j.raw->>'requiredExperienceFilter'), '')
          WHEN 'Beginner' THEN 0
          WHEN 'Minimum 3 years' THEN 3
          WHEN 'Minimum 5 years' THEN 5
          WHEN 'Minimum 10 years' THEN 10
        END
      -- PERSONIO : borne basse d'un intervalle d'années explicite.
      WHEN j.source = 'PERSONIO' THEN
        CASE nullif(trim(j.raw->>'yearsOfExperience'), '')
          WHEN 'lt-1' THEN 0
          WHEN '1-2' THEN 1
          WHEN '2-5' THEN 2
          WHEN '5-7' THEN 5
          WHEN '7-10' THEN 7
          WHEN '10-15' THEN 10
          WHEN 'gt-15' THEN 15
        END
      -- Les producteurs DÉJÀ en place, conservés tels quels.
      ELSE j."experienceYears"
    END AS exp_apres,
    -- NIVEAU D'ÉTUDES, libellé natif préfixé du référentiel.
    CASE
      WHEN j.source = 'RECRUITEE'
        AND nullif(trim(j.raw->>'education_code'), '') IS NOT NULL
        AND lower(trim(j.raw->>'education_code')) NOT IN ('unspecified','not specified','none','n/a')
        THEN 'RECRUITEE:' || trim(j.raw->>'education_code')
      WHEN j.source = 'WTTJ'
        AND nullif(trim(j.raw->>'education_level'), '') IS NOT NULL
        AND lower(trim(j.raw->>'education_level')) NOT IN ('unspecified','not specified','none','n/a')
        THEN 'WTTJ:' || trim(j.raw->>'education_level')
      WHEN j.source = 'WORKABLE'
        AND nullif(trim(j.raw->>'education'), '') IS NOT NULL
        AND lower(trim(j.raw->>'education')) NOT IN ('unspecified','not specified','none','n/a')
        THEN 'WORKABLE:' || trim(j.raw->>'education')
    END AS edu_apres,
    j."experienceYears" AS exp_avant
  FROM "Job" j
  WHERE j."isActive" = true
)
SELECT
  marche,
  count(*)::int                                            AS offres_actives,
  count(exp_avant)::int                                    AS exp_avant,
  count(exp_apres)::int                                    AS exp_apres,
  round(count(exp_apres)::numeric / count(*), 3)           AS couv_exp,
  (count(exp_apres)::numeric / count(*) >= 0.2)            AS exp_passe_seuil,
  count(edu_apres)::int                                    AS edu_apres,
  round(count(edu_apres)::numeric / count(*), 3)           AS couv_edu,
  (count(edu_apres)::numeric / count(*) >= 0.2)            AS edu_passe_seuil
FROM simule
GROUP BY marche
HAVING count(*) >= 100
ORDER BY count(exp_apres) DESC;
