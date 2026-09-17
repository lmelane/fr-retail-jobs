ALTER TABLE "JobSource" ADD COLUMN "presentation" JSONB;

-- A RAW/capture change cannot keep a projection of the preceding observation.
CREATE FUNCTION invalidate_publication_presentation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.raw IS DISTINCT FROM OLD.raw OR NEW.url IS DISTINCT FROM OLD.url
      OR NEW.title IS DISTINCT FROM OLD.title OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
      OR NEW."captureBatchId" IS DISTINCT FROM OLD."captureBatchId"
      OR NEW."captureOutputId" IS DISTINCT FROM OLD."captureOutputId")
     AND NEW.presentation IS NOT DISTINCT FROM OLD.presentation THEN
    NEW.presentation := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invalidate_publication_presentation BEFORE UPDATE ON "JobSource"
  FOR EACH ROW EXECUTE FUNCTION invalidate_publication_presentation();
