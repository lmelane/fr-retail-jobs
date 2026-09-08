-- REFONTE ATOMIQUE — un champ « contrat » franco-centré devient CINQ dimensions
-- mondiales et indépendantes. Décision Loïc, 2026-09-08.
--
-- Le modèle précédent mélangeait quatre concepts dans une colonne unique, avec
-- une grille juridique FRANÇAISE (CDI/CDD/STAGE) appliquée à un catalogue
-- mondial. Deux mesures l'ont prouvé :
--   · `employment_type_code` sert « parttime_fixed_term » (225 offres) et
--     « fulltime_permanent » (154) — DEUX dimensions dans une seule valeur ;
--   · 2 359 offres Sephora sont « CDD » ET « Seasonal » : les deux sont vraies.
--
-- `seniority` était contaminé par la même confusion : INTERNSHIP 3 438,
-- APPRENTICESHIP 658, GRADUATE 200 sont des PROGRAMMES, pas des niveaux.
--
-- Pas de colonne parallèle, pas de dual-write, pas de double vérité.
--
-- ROLLBACK (avant tout nouvel ingest) :
--   ALTER TABLE "Job" ADD COLUMN "contract" TEXT, ADD COLUMN "workingTime" TEXT;
--   UPDATE "Job" SET
--     "contract" = CASE
--       WHEN "programType" = 'INTERNSHIP' THEN 'STAGE'
--       WHEN "programType" = 'APPRENTICESHIP' THEN 'ALTERNANCE'
--       WHEN "programType" = 'GRADUATE_PROGRAM' THEN 'GRADUATE'
--       WHEN "programType" = 'VIE' THEN 'VIE'
--       WHEN "engagementType" = 'FREELANCE' THEN 'FREELANCE'
--       WHEN "employmentTerm" = 'PERMANENT' THEN 'CDI'
--       WHEN "employmentTerm" = 'FIXED_TERM' THEN 'CDD'
--       WHEN "employmentTerm" = 'TEMPORARY' THEN 'INTERIM' END,
--     "workingTime" = CASE "workTime"
--       WHEN 'FULL_TIME' THEN 'TEMPS_PLEIN' WHEN 'PART_TIME' THEN 'TEMPS_PARTIEL' END;
--   UPDATE "Job" SET "seniority" = "programType" WHERE "programType" IS NOT NULL
--     AND "seniority" IS NULL AND "programType" <> 'VIE';
--   ALTER TABLE "Job" DROP COLUMN "employmentTerm", DROP COLUMN "workTime",
--     DROP COLUMN "programType", DROP COLUMN "engagementType", DROP COLUMN "isSeasonal";
--   (Perte bornée : `isSeasonal` et la distinction FREELANCE /
--    INDEPENDENT_CONTRACTOR ne se re-dérivent pas — l'ancien modèle ne
--    pouvait pas les porter.)

ALTER TABLE "Job"
  ADD COLUMN "employmentTerm"  TEXT,
  ADD COLUMN "workTime"        TEXT,
  ADD COLUMN "programType"     TEXT,
  ADD COLUMN "engagementType"  TEXT,
  ADD COLUMN "isSeasonal"      BOOLEAN;

-- 1. DURÉE de la relation. Un programme (stage, alternance, V.I.E) et un
--    freelance n'en portent AUCUNE : on ne déduit jamais une dimension d'une
--    autre. Chiffres attendus (dry-run) : PERMANENT 13 830, FIXED_TERM 6 082,
--    TEMPORARY 184 depuis cette colonne ; le reste viendra du prochain ingest.
UPDATE "Job" SET "employmentTerm" = CASE "contract"
  WHEN 'CDI'     THEN 'PERMANENT'
  WHEN 'CDD'     THEN 'FIXED_TERM'
  WHEN 'INTERIM' THEN 'TEMPORARY'
END
WHERE "contract" IN ('CDI', 'CDD', 'INTERIM');

-- 2. RYTHME.
UPDATE "Job" SET "workTime" = CASE "workingTime"
  WHEN 'TEMPS_PLEIN'   THEN 'FULL_TIME'
  WHEN 'TEMPS_PARTIEL' THEN 'PART_TIME'
END
WHERE "workingTime" IN ('TEMPS_PLEIN', 'TEMPS_PARTIEL');

-- 3. PROGRAMME, depuis `contract` (3 611 offres) PUIS depuis `seniority` pour
--    celles que `contract` ne couvre pas (685) — total attendu : 4 296.
UPDATE "Job" SET "programType" = CASE "contract"
  WHEN 'STAGE'      THEN 'INTERNSHIP'
  WHEN 'ALTERNANCE' THEN 'APPRENTICESHIP'
  WHEN 'GRADUATE'   THEN 'GRADUATE_PROGRAM'
  WHEN 'VIE'        THEN 'VIE'
END
WHERE "contract" IN ('STAGE', 'ALTERNANCE', 'GRADUATE', 'VIE');

UPDATE "Job" SET "programType" = CASE "seniority"
  WHEN 'INTERNSHIP'     THEN 'INTERNSHIP'
  WHEN 'APPRENTICESHIP' THEN 'APPRENTICESHIP'
  WHEN 'GRADUATE'       THEN 'GRADUATE_PROGRAM'
END
WHERE "programType" IS NULL AND "seniority" IN ('INTERNSHIP', 'APPRENTICESHIP', 'GRADUATE');

-- 4. NATURE JURIDIQUE. `EMPLOYEE` n'est JAMAIS déduit d'une absence de preuve.
UPDATE "Job" SET "engagementType" = 'FREELANCE' WHERE "contract" = 'FREELANCE';

-- 5. DÉPOLLUTION DE `seniority` — INCONDITIONNELLE.
--    Les 4 296 valeurs de programme sortent de la taxonomie de séniorité, que
--    leur `programType` ait été alimenté par `contract` (3 611) ou par
--    `seniority` elle-même (685). Aucune n'est perdue : chacune a déjà son
--    programType posé ci-dessus. `seniority` ne garde plus que de vrais
--    NIVEAUX : MID, SENIOR, MANAGER, DIRECTOR, EXECUTIVE, JUNIOR.
UPDATE "Job" SET "seniority" = NULL
WHERE "seniority" IN ('INTERNSHIP', 'APPRENTICESHIP', 'GRADUATE');

-- 6. L'ancien modèle disparaît. Aucune compatibilité, aucune double vérité.
DROP INDEX IF EXISTS "Job_contract_idx";
ALTER TABLE "Job" DROP COLUMN "contract", DROP COLUMN "workingTime";

-- Les deux dimensions réellement filtrées portent un index. `programType`
-- (6,3 %), `engagementType` (0,3 %) et `isSeasonal` (3,4 %) n'en ont pas : le
-- faible volume décide de ce qu'on EXPOSE, jamais de la propreté du modèle.
CREATE INDEX "Job_employmentTerm_idx" ON "Job"("employmentTerm");
CREATE INDEX "Job_workTime_idx" ON "Job"("workTime");

-- L'observatoire : les photographies de périmètre `contract` portent les clés de
-- l'ANCIEN modèle (CDI, CDD…). On les SUPPRIME plutôt que de les convertir —
-- réécrire une observation prise en direct violerait l'immuabilité posée en D38,
-- et une série qui compare des CDI à des PERMANENT ne veut rien dire. 36 lignes,
-- 4 jours ; tous les autres périmètres (pays, ville, Maison, métier, secteur,
-- séniorité) restent intacts. La nouvelle série démarre au premier snapshot
-- suivant la mise en production.
DELETE FROM "MarketSnapshot" WHERE scope = 'contract';
