BEGIN;
-- Do not invent a revision or insertion order for historical evidence.
ALTER TABLE "SourceIdentityReview" ADD COLUMN "sourceRevisionId" TEXT;
ALTER TABLE "SourceIdentityReview" ADD COLUMN sequence BIGINT;
ALTER TABLE "SourceIdentityReview" ADD CONSTRAINT "SourceIdentityReview_sourceRevisionId_fkey"
  FOREIGN KEY ("sourceRevisionId") REFERENCES "SourceRevision"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE SEQUENCE "SourceIdentityReview_sequence_seq" AS BIGINT OWNED BY "SourceIdentityReview".sequence;
CREATE UNIQUE INDEX "SourceIdentityReview_sequence_key" ON "SourceIdentityReview"(sequence);
DROP INDEX "SourceIdentityReview_sourceKey_createdAt_idx";
CREATE INDEX "SourceIdentityReview_sourceKey_sequence_idx" ON "SourceIdentityReview"("sourceKey",sequence);
CREATE FUNCTION bind_source_identity_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision TEXT;
BEGIN
  -- Also serializes direct SQL writers against registry edits and other reviews.
  SELECT "currentRevisionId" INTO current_revision FROM "Source" WHERE key=NEW."sourceKey" FOR UPDATE;
  IF current_revision IS NULL OR NEW."sourceRevisionId" IS DISTINCT FROM current_revision THEN
    RAISE EXCEPTION 'Identity review requires the current source revision' USING ERRCODE='23514';
  END IF;
  -- Assigned AFTER taking the source lock. Caller timestamps/ordinals cannot reorder decisions.
  NEW.sequence := nextval('"SourceIdentityReview_sequence_seq"'::regclass);
  RETURN NEW;
END $$;
CREATE TRIGGER "SourceIdentityReview_revision_binding" BEFORE INSERT ON "SourceIdentityReview"
  FOR EACH ROW EXECUTE FUNCTION bind_source_identity_review();
-- Keep the existing UPDATE/DELETE immutability trigger.
COMMIT;
