-- Preserve exact JSONB configuration before any application decoding.
CREATE FUNCTION source_revision_payload(source_key TEXT, display_name TEXT, reader_kind TEXT,
  reader_config JSONB, careers_domain TEXT, job_url_pattern TEXT, source_tier TEXT, tenant_key TEXT)
RETURNS JSONB LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_build_object('version',1,'key',source_key,'maison',display_name,'kind',reader_kind,
    'config',reader_config,'careersDomain',careers_domain,'jobUrlPattern',job_url_pattern,
    'tier',source_tier,'tenantKey',tenant_key)
$$;
CREATE TABLE "SourceRevision" (
  id TEXT PRIMARY KEY, "sourceId" TEXT NOT NULL, "sourceKey" TEXT NOT NULL,
  version INTEGER NOT NULL, payload JSONB NOT NULL, "payloadHash" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceRevision_shape" CHECK (version>0 AND jsonb_typeof(payload)='object'
    AND (payload->>'version'='1') IS TRUE AND (payload->>'key'="sourceKey") IS TRUE
    AND (jsonb_typeof(payload->'config')='object') IS TRUE
    AND "payloadHash"=encode(sha256(convert_to(payload::text,'UTF8')),'hex'))
);
CREATE UNIQUE INDEX "SourceRevision_sourceId_version_key" ON "SourceRevision"("sourceId",version);
CREATE INDEX "SourceRevision_sourceKey_observedAt_idx" ON "SourceRevision"("sourceKey","observedAt");
CREATE TRIGGER "SourceRevision_immutable" BEFORE UPDATE OR DELETE ON "SourceRevision"
  FOR EACH ROW EXECUTE FUNCTION protect_capture_evidence();

ALTER TABLE "Source" ADD COLUMN "currentRevisionId" TEXT NOT NULL DEFAULT (gen_random_uuid())::text;
-- This is the first observed state, not a fabricated history of past changes.
INSERT INTO "SourceRevision" (id,"sourceId","sourceKey",version,payload,"payloadHash")
SELECT s."currentRevisionId",s.id,s.key,1,p.value,encode(sha256(convert_to(p.value::text,'UTF8')),'hex')
FROM "Source" s CROSS JOIN LATERAL (SELECT source_revision_payload(s.key,s.maison,s.kind,s.config,
  s."careersDomain",s."jobUrlPattern",s.tier,s."tenantKey") AS value) p;
ALTER TABLE "Source" ADD CONSTRAINT "Source_currentRevisionId_fkey"
  FOREIGN KEY ("currentRevisionId") REFERENCES "SourceRevision"(id) ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE FUNCTION record_source_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE document JSONB; previous JSONB; next_version INTEGER;
BEGIN
  document:=source_revision_payload(NEW.key,NEW.maison,NEW.kind,NEW.config,NEW."careersDomain",NEW."jobUrlPattern",NEW.tier,NEW."tenantKey");
  IF TG_OP='UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.key IS DISTINCT FROM OLD.key THEN
      RAISE EXCEPTION 'Source registry identity is immutable; retire it and register a distinct source';
    END IF;
    previous:=source_revision_payload(OLD.key,OLD.maison,OLD.kind,OLD.config,OLD."careersDomain",OLD."jobUrlPattern",OLD.tier,OLD."tenantKey");
    IF document=previous THEN
      IF NEW."currentRevisionId" IS DISTINCT FROM OLD."currentRevisionId" THEN RAISE EXCEPTION 'Source revision pointer is managed by its configuration'; END IF;
      RETURN NEW;
    END IF;
    SELECT version+1 INTO next_version FROM "SourceRevision" WHERE id=OLD."currentRevisionId" AND "sourceId"=OLD.id AND "sourceKey"=OLD.key;
    IF next_version IS NULL THEN RAISE EXCEPTION 'Source current revision is invalid'; END IF;
    IF NEW.status='ACTIVE' THEN NEW.status:='PAUSED'; END IF;
  ELSE
    next_version:=1;
  END IF;
  NEW."currentRevisionId":=gen_random_uuid()::text;
  INSERT INTO "SourceRevision"(id,"sourceId","sourceKey",version,payload,"payloadHash")
    VALUES(NEW."currentRevisionId",NEW.id,NEW.key,next_version,document,encode(sha256(convert_to(document::text,'UTF8')),'hex'));
  RETURN NEW;
END $$;
CREATE TRIGGER "Source_record_revision" BEFORE INSERT OR UPDATE ON "Source"
  FOR EACH ROW EXECUTE FUNCTION record_source_revision();

ALTER TABLE "CaptureBatch" ADD COLUMN "sourceRevisionId" TEXT;
ALTER TABLE "CaptureBatch" ADD CONSTRAINT "CaptureBatch_sourceRevisionId_fkey"
  FOREIGN KEY ("sourceRevisionId") REFERENCES "SourceRevision"(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
CREATE INDEX "CaptureBatch_sourceRevisionId_startedAt_idx" ON "CaptureBatch"("sourceRevisionId","startedAt");
CREATE FUNCTION bind_capture_source_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sourceRevisionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Source" WHERE "currentRevisionId"=NEW."sourceRevisionId" AND key=NEW."sourceKey" FOR SHARE
  ) THEN RAISE EXCEPTION 'Capture revision is not the current source configuration'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CaptureBatch_source_revision" BEFORE INSERT ON "CaptureBatch"
  FOR EACH ROW EXECUTE FUNCTION bind_capture_source_revision();
