-- Lot 2E de D-475 (plan docs/architecture/classification-metiers.md §3.7 ; D-475 §31 b et §32) : ADDITIVE.
-- Une table neuve, vide, sans lecteur tant que ce code n'est pas servi : aucune ligne existante n'est touchée,
-- aucun verrou long (création de table et de ses index sur une table vide).
--
-- Le signal « métier manquant » d'un recruteur Catwalks, remis par le backend avec sa clé (`POST
-- /api/metiers/signalements`). La passe de curation suivante le lit et y inscrit sa résolution ; le backend la relit
-- (`GET /api/taxonomie/export?partie=signalements`) pour réécrire le métier de l'offre.
SET lock_timeout = '5s';

CREATE TABLE "OccupationMissingSignal" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "chosenOccupation" TEXT,
  "comment" TEXT,
  "signaledAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolvedOccupation" TEXT,
  "resolvedReleaseId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "OccupationMissingSignal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT occupation_missing_signal_source CHECK ("source" IN ('backend')),
  CONSTRAINT occupation_missing_signal_status CHECK ("status" IN ('OPEN','RESOLVED','REJECTED')),
  -- Une résolution nomme toujours son métier ET la version qui le publie ; un signal ouvert n'a ni l'un ni l'autre.
  CONSTRAINT occupation_missing_signal_resolved CHECK (
    ("status" = 'RESOLVED') = ("resolvedOccupation" IS NOT NULL AND "resolvedReleaseId" IS NOT NULL)
  ),
  CONSTRAINT occupation_missing_signal_closed CHECK (("status" = 'OPEN') = ("resolvedAt" IS NULL)),
  CONSTRAINT occupation_missing_signal_lengths CHECK (
    char_length("externalId") BETWEEN 1 AND 64 AND char_length("offerId") BETWEEN 1 AND 64
    AND char_length("title") BETWEEN 1 AND 500 AND ("comment" IS NULL OR char_length("comment") <= 1000)
    AND ("chosenOccupation" IS NULL OR char_length("chosenOccupation") <= 100)
  )
);
CREATE UNIQUE INDEX "OccupationMissingSignal_source_externalId_key" ON "OccupationMissingSignal"("source", "externalId");
CREATE INDEX "OccupationMissingSignal_status_receivedAt_idx" ON "OccupationMissingSignal"("status", "receivedAt");
ALTER TABLE "OccupationMissingSignal" ADD CONSTRAINT "OccupationMissingSignal_resolvedReleaseId_fkey"
  FOREIGN KEY ("resolvedReleaseId") REFERENCES "OccupationRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Le métier d'une résolution existe dans la version qu'elle cite : même contrôle que le domaine d'une offre directe
-- (`compute_direct_offer_domain`), sinon le backend réécrirait une offre sur un métier que personne ne publie.
CREATE FUNCTION validate_missing_signal_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."resolvedOccupation" IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM "OccupationReleaseConcept" c
  WHERE c."releaseId"=NEW."resolvedReleaseId" AND c."kind"='occupation' AND c."key"=NEW."resolvedOccupation";
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Occupation % unknown to release % for signal %', NEW."resolvedOccupation", NEW."resolvedReleaseId", NEW.id;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER occupation_missing_signal_resolution BEFORE INSERT OR UPDATE OF "resolvedOccupation","resolvedReleaseId"
  ON "OccupationMissingSignal" FOR EACH ROW EXECUTE FUNCTION validate_missing_signal_resolution();
