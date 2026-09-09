ALTER TABLE "Job" ADD COLUMN "mergedIntoId" TEXT;
ALTER TABLE "Job" ADD CONSTRAINT "Job_mergedIntoId_fkey"
  FOREIGN KEY ("mergedIntoId") REFERENCES "Job"(id) ON DELETE NO ACTION;
CREATE INDEX "Job_mergedIntoId_idx" ON "Job"("mergedIntoId");
ALTER TABLE "Job" ADD CONSTRAINT "Job_redirect_inactive"
  CHECK ("mergedIntoId" IS NULL OR (NOT "isActive" AND "mergedIntoId" <> id));

-- All writers, including future connectors and operations scripts, must obey
-- these invariants. Deferred checks allow atomic source transfer + retirement.
CREATE FUNCTION check_job_redirect_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE origin text; target text; employer text; seen text[];
BEGIN
  IF TG_TABLE_NAME = 'JobSource' THEN origin := NEW."jobId";
  ELSE origin := NEW.id; END IF;
  SELECT "mergedIntoId", "companyId" INTO target, employer FROM "Job" WHERE id=origin;
  IF EXISTS (SELECT 1 FROM "Job" WHERE "mergedIntoId"=origin AND "companyId"<>employer) THEN
    RAISE EXCEPTION 'Job redirect employer mismatch: %', origin;
  END IF;
  IF target IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM "JobSource" WHERE "jobId"=origin) THEN
    RAISE EXCEPTION 'Redirected job cannot own source representations: %', origin;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "JobEvent" WHERE "jobId"=origin AND type='MERGED' AND field='mergedInto' AND "after"=target) THEN
    RAISE EXCEPTION 'Job redirect requires a MERGED event: %', origin;
  END IF;
  seen := ARRAY[origin];
  WHILE target IS NOT NULL LOOP
    IF target=ANY(seen) THEN RAISE EXCEPTION 'Job redirect cycle: %', origin; END IF;
    seen := seen || target;
    IF NOT EXISTS (SELECT 1 FROM "Job" WHERE id=target AND "companyId"=employer) THEN
      RAISE EXCEPTION 'Job redirect employer mismatch: %', origin;
    END IF;
    SELECT "mergedIntoId" INTO target FROM "Job" WHERE id=target;
  END LOOP;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER job_redirect_integrity AFTER INSERT OR UPDATE ON "Job"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_job_redirect_integrity();
CREATE CONSTRAINT TRIGGER job_source_redirect_integrity AFTER INSERT OR UPDATE ON "JobSource"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_job_redirect_integrity();

CREATE FUNCTION preserve_job_redirect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."mergedIntoId" IS NOT NULL AND NEW."mergedIntoId" IS DISTINCT FROM OLD."mergedIntoId" THEN
    RAISE EXCEPTION 'Job redirect is immutable: %', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preserve_job_redirect BEFORE UPDATE OF "mergedIntoId" ON "Job"
  FOR EACH ROW EXECUTE FUNCTION preserve_job_redirect();
