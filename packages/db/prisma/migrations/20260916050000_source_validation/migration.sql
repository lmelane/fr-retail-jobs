BEGIN;
CREATE TABLE "SourceValidation" (
  id TEXT PRIMARY KEY, sequence BIGSERIAL NOT NULL UNIQUE, "sourceRevisionId" TEXT NOT NULL, "captureBatchId" TEXT NOT NULL,
  "readerRevision" TEXT NOT NULL, "policyVersion" TEXT NOT NULL, verdict TEXT NOT NULL,
  report JSONB NOT NULL, "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceValidation_verdict" CHECK (verdict IN ('VALIDATED','REJECTED')),
  CONSTRAINT "SourceValidation_report" CHECK (jsonb_typeof(report)='object'),
  CONSTRAINT "SourceValidation_sourceRevisionId_fkey" FOREIGN KEY ("sourceRevisionId") REFERENCES "SourceRevision"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "SourceValidation_captureBatchId_fkey" FOREIGN KEY ("captureBatchId") REFERENCES "CaptureBatch"(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "SourceValidation_sourceRevisionId_sequence_idx" ON "SourceValidation"("sourceRevisionId",sequence);
CREATE INDEX "SourceValidation_captureBatchId_idx" ON "SourceValidation"("captureBatchId");
CREATE TRIGGER "SourceValidation_immutable" BEFORE UPDATE OR DELETE ON "SourceValidation"
  FOR EACH ROW EXECUTE FUNCTION protect_capture_evidence();
CREATE FUNCTION bind_source_validation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId"=b.id
    WHERE b.id=NEW."captureBatchId" AND b."sourceRevisionId"=NEW."sourceRevisionId"
      AND b."formatVersion"=2 AND o.status='EXTRACTED' AND o."manifestHash" IS NOT NULL)
  THEN RAISE EXCEPTION 'Source validation requires a completed capture of the same revision'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SourceValidation_capture_binding" BEFORE INSERT ON "SourceValidation"
  FOR EACH ROW EXECUTE FUNCTION bind_source_validation();
COMMIT;
