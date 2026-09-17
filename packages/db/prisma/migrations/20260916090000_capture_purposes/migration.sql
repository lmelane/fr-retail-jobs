BEGIN;
CREATE TYPE "CapturePurpose" AS ENUM ('JOBS','SOURCE_IDENTITY','SOURCE_ACCESS');
-- All earlier batches were made by the job extraction workflow. This adds no
-- ownership/access certification and invents no historical capture order.
ALTER TABLE "CaptureBatch" ADD COLUMN purpose "CapturePurpose" NOT NULL DEFAULT 'JOBS';
CREATE FUNCTION assign_capture_purpose_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose<>'JOBS' THEN NEW."attemptOrdinal":=NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CaptureBatch_purpose_order" BEFORE INSERT ON "CaptureBatch"
  FOR EACH ROW EXECUTE FUNCTION assign_capture_purpose_order();
ALTER TABLE "CaptureBatch" ADD CONSTRAINT "CaptureBatch_purpose_shape" CHECK (
  (purpose='JOBS' AND "formatVersion" IN (1,2)) OR
  (purpose<>'JOBS' AND "formatVersion"=3 AND "sourceRevisionId" IS NOT NULL AND "attemptOrdinal" IS NULL)
);
DROP INDEX "CaptureBatch_sourceRevisionId_attemptOrdinal_idx";
CREATE INDEX "CaptureBatch_sourceRevisionId_purpose_attemptOrdinal_idx"
  ON "CaptureBatch"("sourceRevisionId",purpose,"attemptOrdinal");

ALTER TABLE "CaptureOutcome" DROP CONSTRAINT "CaptureOutcome_shape";
ALTER TABLE "CaptureOutcome" ADD CONSTRAINT "CaptureOutcome_shape" CHECK
  (status IN ('EXTRACTED','SOURCE_EVIDENCE','FAILED') AND "extractedCount">=0);
CREATE OR REPLACE FUNCTION seal_capture_outcome() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version INTEGER; capture_purpose "CapturePurpose"; outputs BIGINT; first_ordinal INTEGER; last_ordinal INTEGER; incomplete BIGINT;
BEGIN
  -- Preserve the same seal/append serialization and MVCC protection as format 2.
  UPDATE "CaptureBatch" b SET id=b.id WHERE b.id=NEW."batchId" RETURNING "formatVersion",purpose INTO version,capture_purpose;
  IF NEW.status='EXTRACTED' AND capture_purpose<>'JOBS' THEN
    RAISE EXCEPTION 'Source evidence cannot be an extracted job result';
  END IF;
  IF NEW.status='SOURCE_EVIDENCE' THEN
    IF capture_purpose='JOBS' OR version<>3 OR NEW."manifestHash" IS NULL OR NEW."outputHash" IS NOT NULL OR NEW."extractedCount"<>0 THEN
      RAISE EXCEPTION 'Source evidence requires its own purpose and manifest, without job outputs';
    END IF;
    SELECT count(*),min(sequence),max(sequence),count(*) FILTER (WHERE NOT complete OR status IS NULL OR format<>'HTTP_RESPONSE')
      INTO outputs,first_ordinal,last_ordinal,incomplete FROM "RawCapture" WHERE "batchId"=NEW."batchId";
    IF outputs NOT BETWEEN 1 AND 6 OR first_ordinal<>0 OR last_ordinal<>outputs-1 OR incomplete<>0 THEN
      RAISE EXCEPTION 'Source evidence requires a bounded complete ordered HTTP journal';
    END IF;
  END IF;
  IF version>=2 AND NEW.status='EXTRACTED' THEN
    IF NEW."manifestHash" IS NULL OR NEW."outputHash" IS NULL THEN
      RAISE EXCEPTION 'Completed extraction requires its result manifest and output hash';
    END IF;
    SELECT count(*),min(ordinal),max(ordinal) INTO outputs,first_ordinal,last_ordinal
      FROM "SourceExtraction" WHERE "batchId"=NEW."batchId";
    IF outputs<>NEW."extractedCount" OR (outputs>0 AND (first_ordinal<>0 OR last_ordinal<>outputs-1)) THEN
      RAISE EXCEPTION 'Extraction outcome differs from its complete ordered outputs';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION require_job_capture_output() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM "CaptureBatch" WHERE id=NEW."batchId" AND purpose='JOBS') THEN
    RAISE EXCEPTION 'Only job captures can have extraction outputs';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "SourceExtraction_job_purpose" BEFORE INSERT ON "SourceExtraction"
  FOR EACH ROW EXECUTE FUNCTION require_job_capture_output();

CREATE FUNCTION require_job_capture_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."captureBatchId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "CaptureBatch" WHERE id=NEW."captureBatchId" AND purpose='JOBS') THEN
    RAISE EXCEPTION 'A source evidence capture cannot attest a job publication';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "JobSource_job_capture_purpose" BEFORE INSERT OR UPDATE OF "captureBatchId" ON "JobSource"
  FOR EACH ROW EXECUTE FUNCTION require_job_capture_publication();
CREATE TRIGGER "SourceObservation_job_capture_purpose" BEFORE INSERT OR UPDATE OF "captureBatchId" ON "SourceObservation"
  FOR EACH ROW EXECUTE FUNCTION require_job_capture_publication();

CREATE OR REPLACE FUNCTION bind_source_validation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CaptureBatch" b JOIN "CaptureOutcome" o ON o."batchId"=b.id
    WHERE b.id=NEW."captureBatchId" AND b."sourceRevisionId"=NEW."sourceRevisionId"
      AND b.purpose='JOBS' AND b."formatVersion"=2 AND o.status='EXTRACTED' AND o."manifestHash" IS NOT NULL)
  THEN RAISE EXCEPTION 'Source validation requires a completed job capture of the same revision'; END IF;
  RETURN NEW;
END $$;
COMMIT;
