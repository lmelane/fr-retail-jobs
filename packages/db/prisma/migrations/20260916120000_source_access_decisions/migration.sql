BEGIN;
-- Freeze the registry before reading the columns that will be removed: a
-- concurrent operator update must not fall between the archive and the drop.
LOCK TABLE "Source" IN ACCESS EXCLUSIVE MODE;
-- Retain the exact historical notes, including nominal owner authorizations.
-- They have no revision/native provenance and cannot certify a current source.
CREATE TABLE "SourceAccessArchive" (
  "sourceKey" TEXT PRIMARY KEY, "sourceId" TEXT NOT NULL, verdict TEXT,
  "checkedAt" TIMESTAMP(3), "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "SourceAccessArchive" ("sourceKey","sourceId",verdict,"checkedAt")
  SELECT key,id,"robotsVerdict","robotsCheckedAt" FROM "Source"
  WHERE "robotsVerdict" IS NOT NULL OR "robotsCheckedAt" IS NOT NULL;
CREATE TRIGGER "SourceAccessArchive_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "SourceAccessArchive"
  FOR EACH ROW EXECUTE FUNCTION protect_capture_evidence();
ALTER TABLE "Source" DROP COLUMN "robotsVerdict", DROP COLUMN "robotsCheckedAt";

ALTER TABLE "CaptureOutcome" ADD COLUMN "transportCoverage" TEXT
  CHECK ("transportCoverage" IN ('HTTP_ONLY','UNSUPPORTED_TRANSPORT'));
CREATE TABLE "SourceAccessDecision" (
  id TEXT PRIMARY KEY, sequence BIGSERIAL NOT NULL UNIQUE, "sourceKey" TEXT NOT NULL,
  "sourceRevisionId" TEXT NOT NULL REFERENCES "SourceRevision"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  "captureBatchId" TEXT REFERENCES "CaptureBatch"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  verdict TEXT NOT NULL CHECK (verdict IN ('ALLOWED','NOT_AUTHORIZED')),
  "policyVersion" TEXT NOT NULL, "readerRevision" TEXT NOT NULL, document JSONB NOT NULL, report JSONB,
  "checkedAt" TIMESTAMP(3) NOT NULL, "validUntil" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SourceAccessDecision_sourceKey_sequence_idx" ON "SourceAccessDecision"("sourceKey",sequence);
CREATE INDEX "SourceAccessDecision_sourceRevisionId_sequence_idx" ON "SourceAccessDecision"("sourceRevisionId",sequence);
CREATE INDEX "SourceAccessDecision_captureBatchId_idx" ON "SourceAccessDecision"("captureBatchId");
CREATE TRIGGER "SourceAccessDecision_immutable" BEFORE UPDATE OR DELETE ON "SourceAccessDecision"
  FOR EACH ROW EXECUTE FUNCTION protect_capture_evidence();
ALTER TABLE "CaptureBatch" ADD COLUMN "accessDecisionId" TEXT REFERENCES "SourceAccessDecision"(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "CaptureBatch_accessDecisionId_idx" ON "CaptureBatch"("accessDecisionId");

CREATE FUNCTION bind_source_access_decision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision TEXT; b "CaptureBatch"%ROWTYPE; r "RawCapture"%ROWTYPE;
  doc JSONB; proof JSONB; item JSONB; scope JSONB; earliest TIMESTAMPTZ; request_count BIGINT; counts BIGINT; ordinal INTEGER:=0;
BEGIN
  SELECT "currentRevisionId" INTO current_revision FROM "Source" WHERE key=NEW."sourceKey" FOR UPDATE;
  doc:=NEW.document; proof:=NEW.report;
  IF current_revision IS NULL OR NEW."sourceRevisionId" IS DISTINCT FROM current_revision OR
    NEW."policyVersion"<>'native-http-access/1' OR length(NEW."readerRevision")=0 OR
    jsonb_typeof(doc) IS DISTINCT FROM 'object' OR pg_column_size(doc)>128000 OR
    (SELECT count(*) FROM jsonb_object_keys(doc))<>9 OR
    doc->>'sourceKey' IS DISTINCT FROM NEW."sourceKey" OR doc->>'sourceRevisionId' IS DISTINCT FROM current_revision OR
    doc->>'captureBatchId' IS DISTINCT FROM NEW."captureBatchId" OR doc->>'verdict' IS DISTINCT FROM NEW.verdict OR
    (doc->>'checkedAt')::timestamptz IS DISTINCT FROM NEW."checkedAt" OR
    NEW."checkedAt" NOT BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()+interval '5 minutes' OR
    coalesce(length(trim(doc->>'reviewer')),0)=0 OR coalesce(length(trim(doc->>'statement')),0)<30 OR
    jsonb_typeof(doc->'scopes') IS DISTINCT FROM 'array' OR jsonb_typeof(doc->'robotsCaptureIds') IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Access decision requires an explicit current source review' USING ERRCODE='23514'; END IF;
  IF NEW.verdict='NOT_AUTHORIZED' THEN
    IF NEW."captureBatchId" IS NOT NULL OR NEW.report IS NOT NULL OR NEW."validUntil" IS NOT NULL OR
      doc->'scopes'<>'[]'::jsonb OR doc->'robotsCaptureIds'<>'[]'::jsonb THEN
      RAISE EXCEPTION 'Access denial cannot grant a scope' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT * INTO b FROM "CaptureBatch" WHERE id=NEW."captureBatchId";
    IF b.id IS NULL OR b."sourceKey" IS DISTINCT FROM NEW."sourceKey" OR b."sourceRevisionId" IS DISTINCT FROM current_revision OR
      b.purpose<>'JOBS' OR b."formatVersion"<>2 OR b."readerRevision" IS DISTINCT FROM NEW."readerRevision" OR
      b."startedAt" NOT BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()+interval '5 minutes' OR
      NEW."checkedAt" < b."startedAt"-interval '5 minutes' OR
      NOT EXISTS (SELECT 1 FROM "CaptureOutcome" WHERE "batchId"=b.id AND status='EXTRACTED' AND "transportCoverage"='HTTP_ONLY' AND "manifestHash" IS NOT NULL) OR
      jsonb_typeof(proof) IS DISTINCT FROM 'object' OR pg_column_size(proof)>128000 OR
      proof->>'policy' IS DISTINCT FROM NEW."policyVersion" OR proof->>'readerRevision' IS DISTINCT FROM NEW."readerRevision" OR
      proof->>'sourceKey' IS DISTINCT FROM NEW."sourceKey" OR proof->>'sourceRevisionId' IS DISTINCT FROM current_revision OR
      proof->>'captureBatchId' IS DISTINCT FROM b.id OR proof->>'authorizationBasis' IS DISTINCT FROM 'OWNER_SECTOR_AUTHORIZATION' OR
      proof->>'ownerDecisionScope' IS DISTINCT FROM 'LUXURY_FASHION_BEAUTY_RETAIL_WATCHES_PUBLIC_JOBS' OR
      proof->>'ownerDecisionAt' IS DISTINCT FROM '2026-09-13' OR coalesce(proof->>'requestSetHash','') !~ '^[a-f0-9]{64}$' OR
      jsonb_array_length(doc->'scopes') NOT BETWEEN 1 AND 64 OR jsonb_array_length(doc->'robotsCaptureIds') NOT BETWEEN 1 AND 64 OR
      jsonb_typeof(proof->'scopeCounts') IS DISTINCT FROM 'array' OR jsonb_typeof(proof->'robots') IS DISTINCT FROM 'array' OR
      jsonb_array_length(proof->'scopeCounts')<>jsonb_array_length(doc->'scopes') OR
      jsonb_array_length(proof->'robots')<>jsonb_array_length(doc->'robotsCaptureIds') OR
      (proof->>'validUntil')::timestamptz IS DISTINCT FROM NEW."validUntil"
    THEN RAISE EXCEPTION 'Access grant requires bound native HTTP evidence and policy projection' USING ERRCODE='23514'; END IF;
    FOR scope IN SELECT value FROM jsonb_array_elements(doc->'scopes') LOOP
      IF coalesce(scope->>'surface','') NOT IN ('PUBLIC_OFFICIAL_API','PUBLIC_ATS_JOB_API','PUBLIC_PORTAL_JSON','PUBLIC_XML_OR_RSS',
        'PUBLIC_SITEMAP','PUBLIC_OFFICIAL_HTML','PUBLIC_ATS_HTML') THEN
        RAISE EXCEPTION 'Access grant cannot classify an unknown or unsupported surface as public' USING ERRCODE='23514';
      END IF;
    END LOOP;
    SELECT count(*) INTO counts FROM "RawCapture" WHERE "batchId"=b.id;
    request_count:=(proof->>'requestCount')::bigint;
    IF counts<1 OR (proof->>'captureCount')::bigint IS DISTINCT FROM counts OR request_count IS NULL OR request_count NOT BETWEEN counts AND 100000 OR
      EXISTS (SELECT 1 FROM "RawCapture" WHERE "batchId"=b.id AND ("requestDataHash" IS NULL OR format<>'HTTP_RESPONSE')) OR
      (SELECT sum(value::text::bigint) FROM jsonb_array_elements(proof->'scopeCounts')) IS DISTINCT FROM request_count OR
      EXISTS (SELECT 1 FROM jsonb_array_elements(proof->'scopeCounts') WHERE value::text::bigint<1) THEN
      RAISE EXCEPTION 'Access coverage differs from the complete native request journal' USING ERRCODE='23514';
    END IF;
    earliest:=least(b."startedAt",NEW."checkedAt");
    FOR item IN SELECT value FROM jsonb_array_elements(proof->'robots') LOOP
      SELECT * INTO b FROM "CaptureBatch" WHERE id=item->>'captureBatchId';
      SELECT * INTO r FROM "RawCapture" WHERE "batchId"=b.id ORDER BY sequence DESC LIMIT 1;
      IF b.id IS NULL OR b.id IS DISTINCT FROM doc->'robotsCaptureIds'->>ordinal OR b.purpose<>'SOURCE_ACCESS' OR b."formatVersion"<>3 OR
        b."sourceKey" IS DISTINCT FROM NEW."sourceKey" OR b."sourceRevisionId" IS DISTINCT FROM current_revision OR b."readerRevision" IS DISTINCT FROM NEW."readerRevision" OR
        b."startedAt" NOT BETWEEN clock_timestamp()-interval '30 days' AND clock_timestamp()+interval '5 minutes' OR
        NEW."checkedAt" < b."startedAt"-interval '5 minutes' OR (item->>'observedAt')::timestamptz IS DISTINCT FROM b."startedAt" OR
        NOT EXISTS (SELECT 1 FROM "CaptureOutcome" WHERE "batchId"=b.id AND status='SOURCE_EVIDENCE' AND "manifestHash" IS NOT NULL) OR
        r.id IS NULL OR r.id IS DISTINCT FROM item->>'responseId' OR r."blobHash" IS NULL OR r."blobHash" IS DISTINCT FROM item->>'bodyHash' OR
        r.status IS DISTINCT FROM (item->>'status')::integer OR NOT r.complete OR r."requestDataHash" IS NULL OR
        coalesce(item->>'observationKind','') NOT IN ('RULES','NO_ROBOTS','UNREACHABLE') THEN
        RAISE EXCEPTION 'Robots observation differs from its current native evidence' USING ERRCODE='23514';
      END IF;
      earliest:=least(earliest,b."startedAt"); ordinal:=ordinal+1;
    END LOOP;
    IF NEW."validUntil" IS DISTINCT FROM earliest+interval '30 days' OR NEW."validUntil" < clock_timestamp() THEN
      RAISE EXCEPTION 'Access validity exceeds native evidence freshness' USING ERRCODE='23514';
    END IF;
  END IF;
  NEW.sequence:=nextval('"SourceAccessDecision_sequence_seq"'::regclass);
  RETURN NEW;
END $$;
CREATE TRIGGER "SourceAccessDecision_bind" BEFORE INSERT ON "SourceAccessDecision"
  FOR EACH ROW EXECUTE FUNCTION bind_source_access_decision();

CREATE FUNCTION bind_collection_access() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_revision TEXT; latest "SourceAccessDecision"%ROWTYPE;
BEGIN
  IF NEW."accessDecisionId" IS NULL THEN RETURN NEW; END IF;
  SELECT "currentRevisionId" INTO current_revision FROM "Source" WHERE key=NEW."sourceKey" FOR SHARE;
  SELECT * INTO latest FROM "SourceAccessDecision" WHERE "sourceKey"=NEW."sourceKey" ORDER BY sequence DESC LIMIT 1;
  IF NEW.purpose<>'JOBS' OR current_revision IS DISTINCT FROM NEW."sourceRevisionId" OR
    latest.id IS DISTINCT FROM NEW."accessDecisionId" OR latest."sourceRevisionId" IS DISTINCT FROM current_revision OR
    latest.verdict IS DISTINCT FROM 'ALLOWED' OR latest."readerRevision" IS DISTINCT FROM NEW."readerRevision" OR
    latest."validUntil" IS NULL OR latest."validUntil" < clock_timestamp() THEN
    RAISE EXCEPTION 'Collection requires the latest current access decision' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CaptureBatch_access_decision" BEFORE INSERT ON "CaptureBatch"
  FOR EACH ROW EXECUTE FUNCTION bind_collection_access();
COMMIT;
