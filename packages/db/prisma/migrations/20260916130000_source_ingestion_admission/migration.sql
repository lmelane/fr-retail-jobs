BEGIN;
CREATE TABLE "SourceIngestionAdmission" (
  "batchId" TEXT PRIMARY KEY REFERENCES "CaptureBatch"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "identityReviewId" TEXT NOT NULL REFERENCES "SourceIdentityReview"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "sourceValidationId" TEXT NOT NULL REFERENCES "SourceValidation"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "policyVersion" TEXT NOT NULL,
  "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SourceIngestionAdmission_identityReviewId_idx" ON "SourceIngestionAdmission"("identityReviewId");
CREATE INDEX "SourceIngestionAdmission_sourceValidationId_idx" ON "SourceIngestionAdmission"("sourceValidationId");
CREATE TRIGGER "SourceIngestionAdmission_immutable" BEFORE UPDATE OR DELETE ON "SourceIngestionAdmission"
  FOR EACH ROW EXECUTE FUNCTION protect_capture_evidence();

CREATE FUNCTION bind_source_ingestion_admission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b "CaptureBatch"%ROWTYPE; s "Source"%ROWTYPE; i "SourceIdentityReview"%ROWTYPE;
  v "SourceValidation"%ROWTYPE; proof "CaptureBatch"%ROWTYPE; a "SourceAccessDecision"%ROWTYPE;
BEGIN
  SELECT * INTO b FROM "CaptureBatch" WHERE id=NEW."batchId";
  SELECT * INTO s FROM "Source" WHERE key=b."sourceKey" FOR UPDATE;
  -- Admission and allocation are one transaction, before any native receipt.
  -- Never manufacture admission for an earlier probe or historical capture.
  IF b.id IS NULL OR s.id IS NULL OR s.status<>'ACTIVE' OR b.purpose<>'JOBS' OR b."formatVersion"<>2 OR
    b."sourceRevisionId" IS DISTINCT FROM s."currentRevisionId" OR b."attemptOrdinal" IS NULL OR
    NEW."policyVersion"<>'native-ingestion-admission/1' OR
    NOT EXISTS (SELECT 1 FROM "CaptureBatch" WHERE id=b.id AND xmin::text=(pg_current_xact_id()::text::numeric % 4294967296)::text) OR
    EXISTS (SELECT 1 FROM "RawCapture" WHERE "batchId"=b.id) OR
    EXISTS (SELECT 1 FROM "CaptureOutcome" WHERE "batchId"=b.id)
  THEN RAISE EXCEPTION 'Ingestion admission requires a newly allocated active source capture' USING ERRCODE='23514'; END IF;
  SELECT * INTO i FROM "SourceIdentityReview" WHERE "sourceKey"=s.key ORDER BY sequence DESC NULLS LAST,"createdAt" DESC,id DESC LIMIT 1;
  IF i.id IS DISTINCT FROM NEW."identityReviewId" OR i.sequence IS NULL OR i.verdict<>'VERIFIED' OR
    i."sourceRevisionId" IS DISTINCT FROM s."currentRevisionId" OR i.method<>'OFFICIAL_LINK' OR i."evidenceCaptureBatchId" IS NULL OR
    i."checkedAt" NOT BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()+interval '5 minutes' OR
    i."relationReport"->>'policy' IS DISTINCT FROM 'official-html-link/1' OR
    i."relationReport"->>'archiveVerified' IS DISTINCT FROM 'true' OR
    i."relationReport"->>'verdict' IS DISTINCT FROM 'LINK_MATCHED' OR
    (i."relationReport"->>'captureObservedAt')::timestamptz NOT BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()+interval '5 minutes'
  THEN RAISE EXCEPTION 'Ingestion admission requires the current native identity decision' USING ERRCODE='23514'; END IF;
  SELECT * INTO v FROM "SourceValidation" WHERE "sourceRevisionId"=s."currentRevisionId" ORDER BY sequence DESC LIMIT 1;
  SELECT * INTO proof FROM "CaptureBatch" WHERE id=v."captureBatchId";
  IF v.id IS DISTINCT FROM NEW."sourceValidationId" OR v.verdict<>'VALIDATED' OR
    v."policyVersion"<>'source-validation-20260916-v1' OR v."readerRevision" IS DISTINCT FROM b."readerRevision" OR
    proof.purpose<>'JOBS' OR proof."attemptOrdinal" IS NULL OR proof."attemptOrdinal">=b."attemptOrdinal" OR
    proof."startedAt" NOT BETWEEN clock_timestamp()-interval '24 hours' AND clock_timestamp()+interval '5 minutes' OR
    EXISTS (SELECT 1 FROM "CaptureBatch" WHERE "sourceRevisionId"=s."currentRevisionId" AND purpose='JOBS'
      AND "attemptOrdinal">proof."attemptOrdinal" AND id<>b.id)
  THEN RAISE EXCEPTION 'Ingestion admission requires the latest current native validation' USING ERRCODE='23514'; END IF;
  SELECT * INTO a FROM "SourceAccessDecision" WHERE "sourceKey"=s.key ORDER BY sequence DESC LIMIT 1;
  IF b."accessDecisionId" IS NULL OR a.id IS DISTINCT FROM b."accessDecisionId" OR a.verdict<>'ALLOWED' OR
    a."sourceRevisionId" IS DISTINCT FROM s."currentRevisionId" OR a."readerRevision" IS DISTINCT FROM b."readerRevision" OR
    a."policyVersion"<>'native-http-access/1' OR a."validUntil" IS NULL OR a."validUntil"<clock_timestamp()
  THEN RAISE EXCEPTION 'Ingestion admission requires the current access decision' USING ERRCODE='23514'; END IF;
  NEW."admittedAt":=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER "SourceIngestionAdmission_bind" BEFORE INSERT ON "SourceIngestionAdmission"
  FOR EACH ROW EXECUTE FUNCTION bind_source_ingestion_admission();
COMMIT;
