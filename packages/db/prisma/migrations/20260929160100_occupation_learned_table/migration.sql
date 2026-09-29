-- Lot 2B de D-475 (plan docs/architecture/classification-metiers.md §3.3) : la TABLE APPRISE, additive.
--
-- Une décision apprise précise en métier une décision FAMILY_ONLY, NO_RULE ou AMBIGUOUS du moteur, jamais un
-- CLASSIFIED de règle : la source de chaque décision est stockée (`occupationDecisionSource`), pour que la règle se
-- vérifie par requête. Deux versions : la taxonomie contre laquelle la table a été apprise, et la sienne. Une version de
-- table est SCELLÉE : son nombre d'entrées est fixé à sa création et contrôlé à la validation de la transaction ; rien
-- ne s'y ajoute ensuite, rien ne s'y modifie ni ne s'efface (audit du lot 2B-3a). Elle porte son reçu et la version
-- précédente, pour revenir. La version active vit dans sa propre table d'état : une écriture dans `OccupationState`
-- remet tout l'index de recherche en file (`catwalks_search_occupation`), ce que l'avancée d'une table ne doit pas faire.
SET lock_timeout = '5s';

CREATE TABLE "OccupationLearnedRelease" (
  "id" TEXT NOT NULL,
  "taxonomyReleaseId" TEXT NOT NULL,
  "previousId" TEXT,
  "contentHash" TEXT NOT NULL,
  "entryCount" INTEGER NOT NULL,
  "receipt" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OccupationLearnedRelease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT occupation_learned_release_count CHECK ("entryCount" >= 0),
  CONSTRAINT occupation_learned_release_chain CHECK ("previousId" IS NULL OR "previousId" <> "id")
);
CREATE UNIQUE INDEX "OccupationLearnedRelease_contentHash_key" ON "OccupationLearnedRelease"("contentHash");
ALTER TABLE "OccupationLearnedRelease" ADD CONSTRAINT "OccupationLearnedRelease_taxonomyReleaseId_fkey" FOREIGN KEY ("taxonomyReleaseId") REFERENCES "OccupationRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OccupationLearnedRelease" ADD CONSTRAINT "OccupationLearnedRelease_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "OccupationLearnedRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OccupationLearnedEntry" (
  "releaseId" TEXT NOT NULL,
  "titleKey" TEXT NOT NULL,
  "occupationCode" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  CONSTRAINT "OccupationLearnedEntry_pkey" PRIMARY KEY ("releaseId","titleKey")
);
ALTER TABLE "OccupationLearnedEntry" ADD CONSTRAINT "OccupationLearnedEntry_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "OccupationLearnedRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preuves : ni modifiées, ni effacées, ni vidées.
CREATE TRIGGER occupation_learned_release_immutable BEFORE UPDATE OR DELETE ON "OccupationLearnedRelease" FOR EACH ROW EXECUTE FUNCTION protect_occupation_evidence();
CREATE TRIGGER occupation_learned_entry_immutable BEFORE UPDATE OR DELETE ON "OccupationLearnedEntry" FOR EACH ROW EXECUTE FUNCTION protect_occupation_evidence();
CREATE TRIGGER occupation_learned_release_no_truncate BEFORE TRUNCATE ON "OccupationLearnedRelease" FOR EACH STATEMENT EXECUTE FUNCTION protect_occupation_evidence();
CREATE TRIGGER occupation_learned_entry_no_truncate BEFORE TRUNCATE ON "OccupationLearnedEntry" FOR EACH STATEMENT EXECUTE FUNCTION protect_occupation_evidence();

-- Une entrée ne désigne qu'un métier de la taxonomie de sa table.
CREATE FUNCTION validate_learned_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "OccupationLearnedRelease" l JOIN "OccupationReleaseConcept" c ON c."releaseId"=l."taxonomyReleaseId"
   WHERE l.id=NEW."releaseId" AND c."kind"='occupation' AND c."key"=NEW."occupationCode") THEN
  RAISE EXCEPTION 'Learned occupation % unknown to the taxonomy of %',NEW."occupationCode",NEW."releaseId";
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER occupation_learned_entry_integrity BEFORE INSERT ON "OccupationLearnedEntry" FOR EACH ROW EXECUTE FUNCTION validate_learned_entry();

-- Le sceau : à la validation de toute transaction qui crée une version ou y ajoute une entrée, la version compte
-- exactement ses entrées déclarées ; une entrée ajoutée après coup fait échouer sa transaction.
CREATE FUNCTION check_learned_release_sealed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version text; attendu int; reel int;
BEGIN
 -- Deux tables, deux formes de ligne : un IF, jamais un CASE qui nommerait un champ absent de l'autre table.
 IF TG_TABLE_NAME='OccupationLearnedEntry' THEN version := NEW."releaseId"; ELSE version := NEW.id; END IF;
 SELECT "entryCount" INTO attendu FROM "OccupationLearnedRelease" WHERE id=version;
 SELECT count(*) INTO reel FROM "OccupationLearnedEntry" WHERE "releaseId"=version;
 IF reel <> attendu THEN RAISE EXCEPTION 'Learned release % is sealed with % entries, found %',version,attendu,reel; END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER occupation_learned_release_sealed AFTER INSERT ON "OccupationLearnedRelease" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_learned_release_sealed();
CREATE CONSTRAINT TRIGGER occupation_learned_entry_sealed AFTER INSERT ON "OccupationLearnedEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_learned_release_sealed();

-- La version active, à part ; elle n'active qu'une table apprise contre la taxonomie active.
CREATE TABLE "OccupationLearnedState" (
  "id" TEXT NOT NULL,
  "releaseId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OccupationLearnedState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT occupation_learned_state_single CHECK ("id" = 'active')
);
ALTER TABLE "OccupationLearnedState" ADD CONSTRAINT "OccupationLearnedState_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "OccupationLearnedRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "OccupationLearnedState" ("id","releaseId") VALUES ('active', NULL);
CREATE FUNCTION validate_learned_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."releaseId" IS NOT NULL AND (SELECT "taxonomyReleaseId" FROM "OccupationLearnedRelease" WHERE id=NEW."releaseId")
   IS DISTINCT FROM (SELECT "releaseId" FROM "OccupationState" WHERE id='active') THEN
  RAISE EXCEPTION 'Learned release % was not learned against the active taxonomy',NEW."releaseId";
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER occupation_learned_state_taxonomy BEFORE INSERT OR UPDATE ON "OccupationLearnedState" FOR EACH ROW EXECUTE FUNCTION validate_learned_state();

-- Sur chaque décision : la version de table évaluée et la source (règle, table apprise, back-office). Une décision
-- apprise porte sa version de table, et cette table a été apprise contre la version de taxonomie de la décision.
-- Contraintes NOT VALID sur Job et DirectOffer : colonnes neuves, nulles partout, valides par construction.
ALTER TABLE "Job"
  ADD COLUMN "occupationLearnedReleaseId" TEXT,
  ADD COLUMN "occupationDecisionSource" TEXT;
ALTER TABLE "DirectOffer"
  ADD COLUMN "occupationLearnedReleaseId" TEXT,
  ADD COLUMN "occupationDecisionSource" TEXT;
ALTER TABLE "Job" ADD CONSTRAINT "Job_occupationLearnedReleaseId_fkey" FOREIGN KEY ("occupationLearnedReleaseId") REFERENCES "OccupationLearnedRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "DirectOffer" ADD CONSTRAINT "DirectOffer_occupationLearnedReleaseId_fkey" FOREIGN KEY ("occupationLearnedReleaseId") REFERENCES "OccupationLearnedRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Job" ADD CONSTRAINT job_occupation_source CHECK ("occupationDecisionSource" IS NULL OR "occupationDecisionSource" IN ('rule','learned','backoffice')) NOT VALID;
ALTER TABLE "DirectOffer" ADD CONSTRAINT direct_offer_occupation_source CHECK ("occupationDecisionSource" IS NULL OR "occupationDecisionSource" IN ('rule','learned','backoffice')) NOT VALID;
ALTER TABLE "Job" ADD CONSTRAINT job_learned_decision_versioned CHECK ("occupationDecisionSource" IS DISTINCT FROM 'learned' OR "occupationLearnedReleaseId" IS NOT NULL) NOT VALID;
ALTER TABLE "DirectOffer" ADD CONSTRAINT direct_offer_learned_decision_versioned CHECK ("occupationDecisionSource" IS DISTINCT FROM 'learned' OR "occupationLearnedReleaseId" IS NOT NULL) NOT VALID;
CREATE FUNCTION validate_learned_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."occupationLearnedReleaseId" IS NOT NULL AND (SELECT "taxonomyReleaseId" FROM "OccupationLearnedRelease" WHERE id=NEW."occupationLearnedReleaseId")
   IS DISTINCT FROM NEW."occupationReleaseId" THEN
  RAISE EXCEPTION 'Learned release % does not belong to taxonomy % for %',NEW."occupationLearnedReleaseId",NEW."occupationReleaseId",NEW.id;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER job_learned_decision BEFORE INSERT OR UPDATE OF "occupationReleaseId","occupationLearnedReleaseId" ON "Job" FOR EACH ROW EXECUTE FUNCTION validate_learned_decision();
CREATE TRIGGER direct_offer_learned_decision BEFORE INSERT OR UPDATE OF "occupationReleaseId","occupationLearnedReleaseId" ON "DirectOffer" FOR EACH ROW EXECUTE FUNCTION validate_learned_decision();
