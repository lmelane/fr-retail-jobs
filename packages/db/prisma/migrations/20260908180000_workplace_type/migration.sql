-- `remote` (vocabulaire propriétaire) → `workplaceType` (taxonomie mondiale).
--
-- Mesuré le 2026-09-08 : la colonne était nulle à 95,3 %, `full` — le vrai
-- télétravail — ne concernait que 70 offres, et « unknown » était stocké comme
-- une VALEUR sur 648 lignes. Le vocabulaire de Welcome to the Jungle
-- (`punctual`, `partial`, `fulltime`) vivait dans le modèle mondial.
--
-- Le faible volume (5,35 % de couverture après audit) ne justifie pas de garder
-- un champ mal défini : il décide de ce qu'on EXPOSE, pas de la propreté du
-- modèle.
--
-- Aucun snapshot de périmètre `remote` n'existe (vérifié) : rien à supprimer
-- côté observatoire, la série démarre proprement.
--
-- ROLLBACK (avant tout nouvel ingest) :
--   ALTER TABLE "Job" ADD COLUMN "remote" TEXT;
--   UPDATE "Job" SET "remote" = CASE "workplaceType"
--     WHEN 'ONSITE' THEN 'no' WHEN 'HYBRID' THEN 'partial' WHEN 'REMOTE' THEN 'full' END;
--   ALTER TABLE "Job" DROP COLUMN "workplaceType";
--   (Perte bornée : la nuance `punctual`/`unknown` ne se re-dérive pas — elle
--    reste lisible dans Job.raw.)

ALTER TABLE "Job" ADD COLUMN "workplaceType" TEXT;

-- Conversion des seules valeurs qui PORTENT une information.
--   no       → ONSITE   (WTTJ : « Non autorisé »)
--   partial  → HYBRID   (« Télétravail partiel autorisé »)
--   full     → REMOTE   (« Télétravail total possible »)
--   punctual → ONSITE   (« Télétravail PONCTUEL autorisé » — poste principalement
--                        sur site, pas un régime hybride régulier ; décision Loïc,
--                        sémantique vérifiée dans la documentation de l'API WTTJ)
--   unknown  → NULL     (une non-réponse n'est pas une valeur)
UPDATE "Job" SET "workplaceType" = CASE "remote"
  WHEN 'no'       THEN 'ONSITE'
  WHEN 'punctual' THEN 'ONSITE'
  WHEN 'partial'  THEN 'HYBRID'
  WHEN 'full'     THEN 'REMOTE'
  ELSE NULL
END
WHERE "remote" IS NOT NULL;

ALTER TABLE "Job" DROP COLUMN "remote";
