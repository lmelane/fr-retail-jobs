-- Mesures D-435/D-436 — L'EXPÉRIENCE REQUISE est-elle publiée à la source, et la jetons-nous ?
-- LECTURE SEULE. Rejouer avec :
--   POSTGRES_PASSWORD=… node audits/mesures-d435-d436/q.mjs --file audits/mesures-d435-d436/<extrait>.sql
-- Chaque bloc ci-dessous se joue séparément (le script n'accepte qu'un SELECT à la fois).

-- =====================================================================
-- M1 — WORKDAY : le `detail` archivé est-il complet, et porte-t-il l'expérience ?
-- Résultat 15/09/2026 : 12 721 offres, 4 clés de tête (hiringOrganization,
-- jobPostingInfo, similarJobs, userAuthenticated) → le détail est COMPLET,
-- ce n'est pas une projection de notre adaptateur.
-- =====================================================================
SELECT k AS cle, count(*)::int AS n
FROM "Job" j, LATERAL jsonb_object_keys(j.raw->'detail') k
WHERE j.source='WORKDAY' AND j."isActive"=true AND jsonb_typeof(j.raw->'detail')='object'
GROUP BY 1 ORDER BY 2 DESC;

-- M2 — WORKDAY : les 26 clés de jobPostingInfo. AUCUNE n'est une expérience.
SELECT k AS cle, count(*)::int AS n
FROM "Job" j, LATERAL jsonb_object_keys(j.raw->'detail'->'jobPostingInfo') k
WHERE j.source='WORKDAY' AND j."isActive"=true AND jsonb_typeof(j.raw->'detail'->'jobPostingInfo')='object'
GROUP BY 1 ORDER BY 1;

-- M3 — WORKDAY : que contiennent vraiment `bulletFields` ?
-- Résultat : identifiants de réquisition (14 720 à 1 élément), villes + contrat
-- (3 885 à 3 éléments), catégorie (835 à 2). 2 lignes sur 28 061 portent un
-- signal d'expérience → bruit, pas une source.
SELECT jsonb_array_length(j.raw->'bulletFields')::int AS taille, count(*)::int AS n,
       (array_agg(j.raw->'bulletFields' ORDER BY random()))[1]::text AS exemple
FROM "Job" j
WHERE j.source='WORKDAY' AND j."isActive"=true AND jsonb_typeof(j.raw->'bulletFields')='array'
GROUP BY 1 ORDER BY 2 DESC;

-- M4 — WORKDAY : l'expérience est-elle dans le TEXTE LIBRE de la description ?
-- Résultat : 3 810 / 12 721 (30 %) portent un motif « N years ». C'est de
-- l'EXTRACTION, pas de la donnée déclarée — hors périmètre « données réelles ».
SELECT count(*)::int AS total_detail,
  count(*) FILTER (WHERE j.raw->'detail'->'jobPostingInfo'->>'jobDescription' ~* '[0-9]+\s*\+?\s*(years?|yrs?|ans)')::int AS desc_avec_n_annees,
  count(*) FILTER (WHERE j.raw->'detail'->'jobPostingInfo'->>'jobDescription' ~* '(experience|expérience)')::int AS desc_mot_experience
FROM "Job" j
WHERE j.source='WORKDAY' AND j."isActive"=true AND jsonb_typeof(j.raw->'detail'->'jobPostingInfo')='object';

-- =====================================================================
-- M5 — ICIMS / SUCCESSFACTORS : le JSON-LD de la page de détail est archivé
-- ENTIER dans raw.postingEvidence.jobPosting (lib/postingEvidence.ts).
-- iCIMS : 1 531 offres, 15 clés, PAS de `experienceRequirements`.
-- SuccessFactors : 3 811 offres à jobPostingCount = 0 → ces pages ne portent
-- AUCUN JSON-LD (elles sont en microdata) : postingEvidence y est une coquille.
-- =====================================================================
SELECT j.source::text AS ats, k AS cle, count(*)::int AS n
FROM "Job" j, LATERAL jsonb_object_keys(j.raw->'postingEvidence'->'jobPosting') k
WHERE j.source IN ('SUCCESSFACTORS','ICIMS') AND j."isActive"=true
  AND jsonb_typeof(j.raw->'postingEvidence'->'jobPosting')='object'
GROUP BY 1,2 ORDER BY 1,3 DESC;

-- M6 — SUCCESSFACTORS : `filter3` EST un niveau de carrière publié par le tenant.
-- 151 offres : Experienced Professional 91 · Early Career 25 · Leadership 19 ·
-- Young Talents 15. Concentré sur Douglas (DE) : 146/151. Stocké, jamais mappé.
SELECT j."countryCode" AS pays, j.raw->>'filter3' AS niveau, count(*)::int AS n
FROM "Job" j WHERE j.source='SUCCESSFACTORS' AND j."isActive"=true AND j.raw ? 'filter3'
GROUP BY 1,2 ORDER BY 3 DESC;

-- =====================================================================
-- M7 — LE CONTRE-EXEMPLE : LVMH et SmartRecruiters publient un champ dédié,
-- il est archivé dans raw… et AUCUN adaptateur ne le lit (mappe = 0 partout).
-- LVMH `requiredExperience` : 6 361/6 361 offres.
-- SmartRecruiters `experienceLevel` : 5 849/5 849 offres.
-- =====================================================================
SELECT j.raw->>'requiredExperience' AS valeur, count(*)::int AS n,
       count(j."experienceYears")::int AS mappe_vers_experienceYears
FROM "Job" j WHERE j.source='LVMH_ALGOLIA' AND j."isActive"=true
GROUP BY 1 ORDER BY 2 DESC LIMIT 15;

SELECT j.raw->'experienceLevel'->>'label' AS label, count(*)::int AS n,
       count(j."experienceYears")::int AS mappe_vers_experienceYears
FROM "Job" j WHERE j.source='SMARTRECRUITERS' AND j."isActive"=true
GROUP BY 1 ORDER BY 2 DESC;

-- =====================================================================
-- M8 — IMPACT CHIFFRÉ : si l'on mappait TOUS les champs d'expérience
-- réellement publiés et déjà archivés, quelle couverture par marché ?
-- Seuil d'affichage d'une facette : 0.2 (packages/db/marches.ts:64).
-- Résultat : US 8,2 % · AU 14,3 % · CH 10,2 % → les trois marchés cibles
-- RESTENT SOUS LE SEUIL. Passent : FR 20,7 · CA 26,1 · IT 28,1 · BE 23,4 ·
-- PT 26,9 · SG 31,3 · AT 25,1 · PL 26,6 · SE 21,6.
-- =====================================================================
WITH x AS (
  SELECT j."countryCode" AS pays,
    CASE
      WHEN j.source='LVMH_ALGOLIA'    AND coalesce(j.raw->>'requiredExperience','')<>''                            THEN 1
      WHEN j.source='SMARTRECRUITERS' AND coalesce(j.raw->'experienceLevel'->>'id','') NOT IN ('','not_applicable') THEN 1
      WHEN j.source='SUCCESSFACTORS'  AND j.raw ? 'filter3'                                                        THEN 1
      WHEN j.source='PHENOM'          AND coalesce(j.raw->>'experienceRequired','')<>''                            THEN 1
      WHEN j.source='ORACLE_HCM'      AND coalesce(j.raw->>'requiredExperience','')<>''                            THEN 1
      WHEN j."experienceYears" IS NOT NULL                                                                         THEN 1
      ELSE 0 END AS recuperable
  FROM "Job" j WHERE j."isActive"=true AND j."countryCode" IS NOT NULL)
SELECT pays, count(*)::int AS actives, sum(recuperable)::int AS recuperable,
       round(100.0*sum(recuperable)/count(*),1)::text AS pct,
       CASE WHEN 1.0*sum(recuperable)/count(*) >= 0.2 THEN 'PASSE' ELSE 'sous seuil' END AS seuil_20
FROM x GROUP BY 1 HAVING count(*)>300 ORDER BY 2 DESC;

-- M10 — SUCCESSFACTORS : LE PARTAGE DES DEUX CHEMINS, décisif.
-- 3 999 offres (95 %) passent par le chemin HTML, dont la projection de listing
-- (adapters/successfactors.ts:438) ne garde que {slug, source} : tout le reste
-- de la ligne est jeté. 211 offres passent par RMK v2 (raw: {...item}, complet),
-- et 151 d'entre elles portent `filter3` = un niveau de carrière réel.
SELECT j.raw->>'source' AS chemin, count(*)::int AS n,
       count(*) FILTER (WHERE j.raw ? 'filter3')::int AS avec_filter3
FROM "Job" j WHERE j.source='SUCCESSFACTORS' AND j."isActive"=true
GROUP BY 1 ORDER BY 2 DESC;

-- M11 — SUCCESSFACTORS : le sac générique `careersiteProperties` (microdata
-- data-careersite-propertyid, capturé par parseMicrodataDetail:541).
-- `customfield2` MÉLANGE contrat ("Permanent", "Stage") et niveau
-- ("Professional" 138, "Internship" 25, "Graduate" 13, "Expert" 11) dans le
-- MÊME slot : le sens dépend du tenant, il n'est pas typé. ~60 offres US.
SELECT p.k AS champ, left(p.v,60) AS valeur, count(*)::int AS n
FROM "Job" j, LATERAL jsonb_each_text(j.raw->'postingEvidence'->'careersiteProperties') AS p(k,v)
WHERE j.source='SUCCESSFACTORS' AND j."isActive"=true
  AND jsonb_typeof(j.raw->'postingEvidence'->'careersiteProperties')='object'
  AND p.k LIKE 'customfield%'
GROUP BY 1,2 ORDER BY 3 DESC LIMIT 22;

-- M12 — ICIMS : zéro `experienceRequirements` sur 1 592 offres actives.
-- Le JSON-LD est pourtant archivé ENTIER : l'absence est celle de la source.
SELECT count(*)::int AS icims_actives,
  count(*) FILTER (WHERE j.raw->'postingEvidence'->'jobPosting' ? 'experienceRequirements')::int AS avec_exp_req
FROM "Job" j WHERE j.source='ICIMS' AND j."isActive"=true;

-- M13 — WORKDAY : nos clés de raw = les clés de l'API de listing (5-6) + nos 3
-- ajouts (detail, facet, locationPrefix). RIEN n'est jeté : `raw: job` est un
-- spread de l'objet API complet (adapters/workday.ts:135).
SELECT k AS cle, count(*)::int AS n
FROM "Job" j, LATERAL jsonb_object_keys(j.raw) k
WHERE j.source='WORKDAY' AND j."isActive"=true GROUP BY 1 ORDER BY 2 DESC;

-- M9 — Qui écrit `experienceYears` aujourd'hui ? Seulement WTTJ (447) et HARRI (36).
-- Aucun des deux ne sert US/AU/CH. (Code : adapters/wttj.ts:212, adapters/harri.ts:116.)
SELECT j.source::text AS ats, count(*)::int AS actives, count(j."experienceYears")::int AS exp_annees
FROM "Job" j WHERE j."isActive"=true GROUP BY 1 HAVING count(j."experienceYears")>0 ORDER BY 3 DESC;
