-- Lot 2B de D-475 (plan docs/architecture/classification-metiers.md §3.3) : la TABLE APPRISE, additive.
--
-- Une décision apprise précise en métier une décision FAMILY_ONLY, NO_RULE ou AMBIGUOUS du moteur, jamais un
-- CLASSIFIED (la règle, dans le code). Deux versions : la taxonomie contre laquelle elle a été apprise, et la sienne ;
-- une version de table est immuable, porte son reçu et la version précédente, pour revenir en arrière. La version
-- active vit dans sa propre table d'état : une écriture dans `OccupationState` remet aujourd'hui en file tout l'index
-- de recherche (déclencheur `catwalks_search_occupation`), ce que l'avancée d'une table apprise ne doit pas faire.
-- Toute décision qui atteint l'étape de la table porte la version de table évaluée (`occupationLearnedReleaseId`).

CREATE TABLE "OccupationLearnedRelease" (
  "id" TEXT NOT NULL,
  "taxonomyReleaseId" TEXT NOT NULL,
  "previousId" TEXT,
  "contentHash" TEXT NOT NULL,
  "receipt" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OccupationLearnedRelease_pkey" PRIMARY KEY ("id")
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

CREATE TABLE "OccupationLearnedState" (
  "id" TEXT NOT NULL,
  "releaseId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OccupationLearnedState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT occupation_learned_state_single CHECK ("id" = 'active')
);
ALTER TABLE "OccupationLearnedState" ADD CONSTRAINT "OccupationLearnedState_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "OccupationLearnedRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
INSERT INTO "OccupationLearnedState" ("id","releaseId") VALUES ('active', NULL);

ALTER TABLE "Job" ADD COLUMN "occupationLearnedReleaseId" TEXT;
ALTER TABLE "DirectOffer" ADD COLUMN "occupationLearnedReleaseId" TEXT;
ALTER TABLE "Job" ADD CONSTRAINT "Job_occupationLearnedReleaseId_fkey" FOREIGN KEY ("occupationLearnedReleaseId") REFERENCES "OccupationLearnedRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DirectOffer" ADD CONSTRAINT "DirectOffer_occupationLearnedReleaseId_fkey" FOREIGN KEY ("occupationLearnedReleaseId") REFERENCES "OccupationLearnedRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Une version de table et ses entrées sont des preuves : ni modifiées ni effacées (comme OccupationRelease).
CREATE TRIGGER occupation_learned_release_immutable BEFORE UPDATE OR DELETE ON "OccupationLearnedRelease" FOR EACH ROW EXECUTE FUNCTION protect_occupation_evidence();
CREATE TRIGGER occupation_learned_entry_immutable BEFORE UPDATE OR DELETE ON "OccupationLearnedEntry" FOR EACH ROW EXECUTE FUNCTION protect_occupation_evidence();

-- Une entrée ne désigne qu'un métier de la taxonomie contre laquelle sa table a été apprise.
CREATE FUNCTION validate_learned_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "OccupationLearnedRelease" l JOIN "OccupationRelease" r ON r.id=l."taxonomyReleaseId",
   jsonb_array_elements(r.manifest->'occupations') x WHERE l.id=NEW."releaseId" AND x->>'key'=NEW."occupationCode") THEN
  RAISE EXCEPTION 'Learned occupation % unknown to the taxonomy of %',NEW."occupationCode",NEW."releaseId";
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER occupation_learned_entry_integrity BEFORE INSERT ON "OccupationLearnedEntry" FOR EACH ROW EXECUTE FUNCTION validate_learned_entry();
