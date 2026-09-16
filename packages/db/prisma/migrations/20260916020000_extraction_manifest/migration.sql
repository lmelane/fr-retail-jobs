-- Original batches remain immutable format 1. New captures keep their result manifest.
ALTER TABLE "CaptureBatch" ALTER COLUMN "formatVersion" SET DEFAULT 2;
ALTER TABLE "CaptureOutcome" ADD COLUMN "manifestHash" TEXT;
ALTER TABLE "CaptureOutcome" ADD CONSTRAINT "CaptureOutcome_manifestHash_fkey"
  FOREIGN KEY ("manifestHash") REFERENCES "RawBlob"("hash") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "CaptureOutcome_manifestHash_completedAt_idx" ON "CaptureOutcome"("manifestHash", "completedAt");

-- Keep metadata immutable while permitting an identical row rewrite. Advancing
-- its MVCC version makes stale REPEATABLE READ snapshots fail serialization.
CREATE FUNCTION protect_capture_batch_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'CaptureBatch is immutable';
END $$;
DROP TRIGGER "CaptureBatch_immutable" ON "CaptureBatch";
CREATE TRIGGER "CaptureBatch_immutable" BEFORE UPDATE OR DELETE ON "CaptureBatch"
  FOR EACH ROW EXECUTE FUNCTION protect_capture_batch_metadata();

-- Serialize journal writes with the outcome. One rewrite per batch per INSERT
-- statement avoids rewriting the batch for every output in createMany().
CREATE FUNCTION protect_capture_append() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE capture_id TEXT;
BEGIN
  FOR capture_id IN SELECT DISTINCT "batchId" FROM inserted_captures ORDER BY "batchId" LOOP
    UPDATE "CaptureBatch" b SET id=b.id WHERE b.id=capture_id;
    IF EXISTS (SELECT 1 FROM "CaptureOutcome" WHERE "batchId"=capture_id) THEN
      RAISE EXCEPTION 'Capture batch is sealed by its immutable outcome';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER "RawCapture_append_before_outcome" AFTER INSERT ON "RawCapture"
  REFERENCING NEW TABLE AS inserted_captures FOR EACH STATEMENT EXECUTE FUNCTION protect_capture_append();
CREATE TRIGGER "SourceExtraction_append_before_outcome" AFTER INSERT ON "SourceExtraction"
  REFERENCING NEW TABLE AS inserted_captures FOR EACH STATEMENT EXECUTE FUNCTION protect_capture_append();

CREATE FUNCTION seal_capture_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version INTEGER; outputs BIGINT; first_ordinal INTEGER; last_ordinal INTEGER;
BEGIN
  UPDATE "CaptureBatch" b SET id=b.id WHERE b.id=NEW."batchId" RETURNING "formatVersion" INTO version;
  IF version >= 2 AND NEW.status='EXTRACTED' THEN
    IF NEW."manifestHash" IS NULL OR NEW."outputHash" IS NULL THEN
      RAISE EXCEPTION 'Completed extraction requires its result manifest and output hash';
    END IF;
    SELECT count(*),min(ordinal),max(ordinal) INTO outputs,first_ordinal,last_ordinal
      FROM "SourceExtraction" WHERE "batchId"=NEW."batchId";
    IF outputs <> NEW."extractedCount" OR (outputs > 0 AND (first_ordinal<>0 OR last_ordinal<>outputs-1)) THEN
      RAISE EXCEPTION 'Extraction outcome differs from its complete ordered outputs';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CaptureOutcome_seal" BEFORE INSERT ON "CaptureOutcome"
  FOR EACH ROW EXECUTE FUNCTION seal_capture_outcome();
