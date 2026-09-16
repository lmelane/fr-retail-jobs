-- Lot F1 (2026-09-16) : retrait effectif du legacy sans lecteur, mesuré sur le
-- clone (77 migrations) et sur la production (44 migrations, lecture seule).
--
-- Colonnes de Job sans aucun lecteur (écrites puis jamais relues) :
--   isFrance (filtre remplacé par countryCode au lot 6), adminArea2 et inseeCode
--   (toujours nuls à l'écriture), occupationGroup / occupationSpecializations /
--   isRetail (dérivés du manifeste, relus depuis lui), isAiRelated / skills /
--   taxonomyVersion (indices IA et compétences sans consommateur), fingerprint
--   (clé « cluster|titre » sans lecteur, index jamais parcouru en production).
-- Colonnes de Company sans code : atsConfig, lastAtsDiscoveryAt, lastJobSyncAt.
-- Index jamais parcourus en production : GeoCache_resolved_idx et les trois
--   index de Job portés par les colonnes retirées.
-- Extension pg_trgm : ses deux index ont été retirés par 20260916210100 ; aucun
--   opérateur trigramme ne subsiste dans le code.
-- Conservés : MarketSnapshot (données historiques, écrivain retiré, décision à
--   prendre), fashionjobsSlug / fashionjobsOfferCount (circuit de découverte
--   réservé par décision propriétaire du 2026-09-11), Job.raw, canonical*.

-- 1. Le déclencheur d'intégrité métier ne vérifie plus le groupe (dérivé).
CREATE OR REPLACE FUNCTION validate_job_occupation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document jsonb; definition jsonb; family jsonb;
BEGIN
 IF NEW."occupationReleaseId" IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW."occupationReleaseId",NEW."occupationCode",NEW."jobFunction") IS NOT DISTINCT FROM ROW(OLD."occupationReleaseId",OLD."occupationCode",OLD."jobFunction") THEN RETURN NEW; END IF;
 SELECT manifest INTO STRICT document FROM "OccupationRelease" WHERE id=NEW."occupationReleaseId";
 IF NEW."occupationCode" IS NOT NULL THEN
  SELECT x INTO definition FROM jsonb_array_elements(document->'occupations') x WHERE x->>'key'=NEW."occupationCode";
  IF definition IS NULL OR definition->>'family' IS DISTINCT FROM NEW."jobFunction" THEN RAISE EXCEPTION 'Occupation/family mismatch for %',NEW.id; END IF;
 END IF;
 IF NEW."jobFunction" IS NOT NULL THEN
  SELECT x INTO family FROM jsonb_array_elements(document->'families') x WHERE x->>'key'=NEW."jobFunction";
  IF family IS NULL THEN RAISE EXCEPTION 'Occupation family unknown to release for %',NEW.id; END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS job_occupation_integrity ON "Job";
CREATE TRIGGER job_occupation_integrity BEFORE INSERT OR UPDATE OF "occupationReleaseId","occupationCode","jobFunction" ON "Job" FOR EACH ROW EXECUTE FUNCTION validate_job_occupation();

-- 2. Index portés par les colonnes retirées, puis index jamais parcouru.
DROP INDEX IF EXISTS "Job_isFrance_isActive_idx";
DROP INDEX IF EXISTS "Job_isFrance_isActive_latitude_longitude_idx";
DROP INDEX IF EXISTS "Job_fingerprint_idx";
DROP INDEX IF EXISTS "GeoCache_resolved_idx";

-- 3. Colonnes.
ALTER TABLE "Job"
  DROP COLUMN "isFrance",
  DROP COLUMN "adminArea2",
  DROP COLUMN "inseeCode",
  DROP COLUMN "occupationGroup",
  DROP COLUMN "occupationSpecializations",
  DROP COLUMN "isRetail",
  DROP COLUMN "isAiRelated",
  DROP COLUMN "skills",
  DROP COLUMN "taxonomyVersion",
  DROP COLUMN "fingerprint";
ALTER TABLE "Company"
  DROP COLUMN "atsConfig",
  DROP COLUMN "lastAtsDiscoveryAt",
  DROP COLUMN "lastJobSyncAt";

-- 4. Extension sans dépendant.
DROP EXTENSION IF EXISTS pg_trgm;
