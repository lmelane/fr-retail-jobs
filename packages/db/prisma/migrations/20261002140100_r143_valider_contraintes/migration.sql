-- Release r6 (02/10/2026) : validation, séparée, des deux CHECK posées NOT VALID par 20261002140000 sur "JobSource".
-- VALIDATE CONSTRAINT prend un verrou SHARE UPDATE EXCLUSIVE : l'API et le worker continuent de lire et d'écrire
-- pendant le parcours. lock_timeout borne l'attente de ce verrou (une autre opération de schéma sur la table).
-- Additive : aucune donnée touchée. Après elle, les deux contraintes sont VALIDÉES (convalidated) comme si elles avaient
-- été posées d'un bloc.
SET lock_timeout = '10s';
ALTER TABLE "JobSource" VALIDATE CONSTRAINT "JobSource_availabilityHold_check";
ALTER TABLE "JobSource" VALIDATE CONSTRAINT "JobSource_availabilityHold_instant_check";
