-- RYTHME DE TRAVAIL — la dimension la plus publiée des marchés anglo-saxons, absente du modèle.
--
-- Mesuré en production le 2026-09-15 sur les descriptions :
--   « flexible schedule / flexibility to work » : US 54 %, CA 26 %, GB 6 %, AU 5 %, DE 3 %, FR 0 %
--   « nights, weekends / evenings and weekends » : CA 28 %, US 27 %, GB 15 %, AU 15 %, FR 0 %
--   « night shift / overnight »                  : US 9 %, CA 2 %
--   « rotating shift / shift work »              : sous 2 % partout — donc PAS de valeur canonique.
--
-- Le seul champ STRUCTURÉ existant (`schedule`, 186 offres) contient « full-or-part-time » :
-- c'est un TEMPS de travail, pas un rythme. Le rythme ne vit que dans les descriptions.
--
-- Migration strictement ADDITIVE : deux colonnes nullable, aucune donnée existante touchée,
-- aucune contrainte posée. Rollback : DROP des deux colonnes.

ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "workSchedule" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "rawSchedule" TEXT;
