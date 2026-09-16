-- A policy insertion must serialize even when there was no earlier row to lock.
-- Publication reads under the same source lifecycle lock. No historical data is
-- rewritten, and RAW never receives an internal scope annotation.
CREATE FUNCTION lock_posting_scope_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_key TEXT;
  affected_keys TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN affected_keys := ARRAY[NEW."sourceKey"];
  ELSIF TG_OP = 'DELETE' THEN affected_keys := ARRAY[OLD."sourceKey"];
  ELSE affected_keys := ARRAY[OLD."sourceKey", NEW."sourceKey"];
  END IF;
  FOR source_key IN SELECT DISTINCT k FROM unnest(affected_keys) AS k ORDER BY k LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('["source-write",' || to_json(source_key)::text || ']', 0));
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PostingScopeDecision_write_lock"
  BEFORE INSERT OR UPDATE OR DELETE ON "PostingScopeDecision"
  FOR EACH ROW EXECUTE FUNCTION lock_posting_scope_write();
