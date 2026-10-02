-- Registre explicite des sources (D-520 §2, lecture D-492 du 02/10/2026) : toute source qui n'est pas ACTIVE porte
-- une intention, un motif, la décision (ou l'absence de décision) qui fonde son état, une trajectoire, la prochaine
-- action et, pour une pause ou une revue humaine, une date de réexamen. Le 02/10, sur 131 sources non ACTIVE, 23
-- n'avaient aucune note et 108 une note libre qui ne disait ni la décision ni la sortie
-- (audits/2026-10-02/registre-explicite/).
--
-- Additif : une table et des colonnes NULLABLES. Aucune ligne existante n'est modifiée ni supprimée.
--  1. "SourceRegistryReview" garde, immuable, chaque fichier relu appliqué (plan et état d'avant), identifié par
--     l'empreinte que l'application recalcule.
--  2. "Source"."status*" porte l'explication courante, et "statusExplainedFor" le statut qu'elle explique : une source
--     dont le statut a changé depuis redevient lisible comme ambiguë (explication périmée), jamais faussement expliquée.
--  3. Les vocabulaires sont fermés ici (CHECK) ; une pause expliquée a toujours sa date de réexamen, une revue humaine
--     sa question.
-- Le déclencheur record_source_revision ne lit aucune de ces colonnes : les écrire ne crée pas de révision et ne
-- remet aucune source en pause.
-- Ordre de livraison : cette migration AVANT le code. Le client Prisma du nouveau code lit ces colonnes à chaque
-- lecture complète d'une Source ; l'ancien code les ignore.
BEGIN;

CREATE TABLE "SourceRegistryReview" (
  id TEXT PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
  plan JSONB NOT NULL,
  before JSONB NOT NULL,
  reviewer TEXT NOT NULL CHECK (length(btrim(reviewer)) > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SourceRegistryReview_createdAt_id_idx" ON "SourceRegistryReview" ("createdAt", id);
CREATE FUNCTION protect_source_registry_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Source registry reviews are immutable; apply a new reviewed file';
END $$;
CREATE TRIGGER source_registry_review_immutable BEFORE UPDATE OR DELETE ON "SourceRegistryReview"
  FOR EACH ROW EXECUTE FUNCTION protect_source_registry_review();

ALTER TABLE "Source"
  ADD COLUMN "statusIntention" TEXT,
  ADD COLUMN "statusTrajectory" TEXT,
  ADD COLUMN "statusBasis" TEXT,
  ADD COLUMN "statusDecision" TEXT,
  ADD COLUMN "statusReason" TEXT,
  ADD COLUMN "statusNextAction" TEXT,
  ADD COLUMN "statusQuestion" TEXT,
  ADD COLUMN "statusReviewAt" DATE,
  ADD COLUMN "statusExplainedFor" "SourceStatus",
  ADD COLUMN "statusReviewId" TEXT REFERENCES "SourceRegistryReview"(id) ON UPDATE NO ACTION ON DELETE RESTRICT;

ALTER TABLE "Source" ADD CONSTRAINT source_status_intention
  CHECK ("statusIntention" IS NULL OR "statusIntention" IN ('COLLECTER', 'COUVERTE_AILLEURS', 'NE_PAS_COLLECTER', 'A_TRANCHER'));
ALTER TABLE "Source" ADD CONSTRAINT source_status_trajectory
  CHECK ("statusTrajectory" IS NULL OR "statusTrajectory" IN ('REVIENT_SEULE', 'A_REPARER', 'REVUE_HUMAINE', 'EXCLUE_PAR_DECISION'));
ALTER TABLE "Source" ADD CONSTRAINT source_status_basis
  CHECK ("statusBasis" IS NULL OR "statusBasis" IN ('DECISION', 'REGLE', 'PREUVE'));
-- Une explication est complète ou absente : jamais un motif sans décision, ni une trajectoire sans prochaine action.
ALTER TABLE "Source" ADD CONSTRAINT source_status_explained CHECK (
  ("statusReviewId" IS NULL AND "statusExplainedFor" IS NULL AND "statusIntention" IS NULL AND "statusTrajectory" IS NULL
     AND "statusBasis" IS NULL AND "statusDecision" IS NULL AND "statusReason" IS NULL AND "statusNextAction" IS NULL
     AND "statusQuestion" IS NULL AND "statusReviewAt" IS NULL)
  OR ("statusReviewId" IS NOT NULL AND "statusExplainedFor" IS NOT NULL AND "statusIntention" IS NOT NULL
     AND "statusTrajectory" IS NOT NULL AND "statusBasis" IS NOT NULL
     AND length(btrim("statusDecision")) > 0 AND length(btrim("statusReason")) > 0 AND length(btrim("statusNextAction")) > 0));
ALTER TABLE "Source" ADD CONSTRAINT source_status_pause_review
  CHECK ("statusExplainedFor" IS DISTINCT FROM 'PAUSED' OR "statusReviewAt" IS NOT NULL);
ALTER TABLE "Source" ADD CONSTRAINT source_status_human_question
  CHECK ("statusTrajectory" IS DISTINCT FROM 'REVUE_HUMAINE' OR (length(btrim("statusQuestion")) > 0 AND "statusReviewAt" IS NOT NULL));
ALTER TABLE "Source" ADD CONSTRAINT source_status_exclusion_retired
  CHECK ("statusTrajectory" IS DISTINCT FROM 'EXCLUE_PAR_DECISION' OR "statusExplainedFor" = 'RETIRED');

COMMIT;
