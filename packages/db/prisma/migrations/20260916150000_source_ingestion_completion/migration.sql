BEGIN;
-- The immutable end of an admitted ingestion: what became of every sealed output.
-- Absence evidence is read from this row and the sealed manifest; no historical
-- completion is fabricated for captures that predate it.
CREATE TABLE "SourceIngestionCompletion" (
  "batchId" TEXT PRIMARY KEY REFERENCES "CaptureBatch"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "reportHash" TEXT NOT NULL REFERENCES "RawBlob"(hash) ON DELETE RESTRICT ON UPDATE RESTRICT,
  published INTEGER NOT NULL CHECK (published >= 0),
  held INTEGER NOT NULL CHECK (held >= 0),
  "writeFailed" INTEGER NOT NULL CHECK ("writeFailed" >= 0),
  skipped INTEGER NOT NULL CHECK (skipped >= 0),
  "readerRevision" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SourceIngestionCompletion_reportHash_idx" ON "SourceIngestionCompletion"("reportHash");
CREATE INDEX "SourceIngestionCompletion_completedAt_idx" ON "SourceIngestionCompletion"("completedAt");
CREATE TRIGGER "SourceIngestionCompletion_immutable" BEFORE UPDATE OR DELETE ON "SourceIngestionCompletion"
  FOR EACH ROW EXECUTE FUNCTION protect_capture_evidence();

CREATE FUNCTION bind_source_ingestion_completion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "CaptureBatch"%ROWTYPE; o "CaptureOutcome"%ROWTYPE;
BEGIN
  SELECT * INTO b FROM "CaptureBatch" WHERE id=NEW."batchId";
  -- Serialize with the source lifecycle writers, exactly like the application lock.
  IF b.id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('["source-write",' || to_json(b."sourceKey")::text || ']', 0));
  END IF;
  SELECT * INTO o FROM "CaptureOutcome" WHERE "batchId"=NEW."batchId";
  -- Only an admitted, sealed job extraction can report how its outputs were treated.
  IF b.id IS NULL OR b.purpose<>'JOBS' OR b."formatVersion"<>2 OR b."sourceRevisionId" IS NULL OR
    NOT EXISTS (SELECT 1 FROM "SourceIngestionAdmission" WHERE "batchId"=b.id) OR
    o."batchId" IS NULL OR o.status<>'EXTRACTED' OR o."manifestHash" IS NULL OR
    NEW."readerRevision" IS DISTINCT FROM b."readerRevision" OR
    NEW."policyVersion"<>'native-ingestion-completion/1' OR
    NEW.published+NEW.held+NEW."writeFailed"+NEW.skipped<>o."extractedCount" OR
    NOT EXISTS (SELECT 1 FROM "RawBlob" WHERE hash=NEW."reportHash")
  THEN RAISE EXCEPTION 'Ingestion completion requires an admitted, sealed job extraction whose outputs are all accounted for' USING ERRCODE='23514'; END IF;
  NEW."completedAt":=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER "SourceIngestionCompletion_bind" BEFORE INSERT ON "SourceIngestionCompletion"
  FOR EACH ROW EXECUTE FUNCTION bind_source_ingestion_completion();
COMMIT;
