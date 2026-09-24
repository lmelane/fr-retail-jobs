-- Candidate prefilter; the public query still enforces country/publication on
-- native Job/DirectOffer rows. Update country changes through the same queue.
BEGIN;
SET LOCAL lock_timeout='2s';
ALTER TABLE "SearchDocument" ADD COLUMN country text GENERATED ALWAYS AS (document->>'country') STORED;
CREATE INDEX "SearchDocument_version_country_idx" ON "SearchDocument"(version,country);
CREATE TRIGGER catwalks_search_job_country AFTER UPDATE OF "countryCode" ON "Job"
 FOR EACH ROW WHEN (NEW."countryCode" IS DISTINCT FROM OLD."countryCode") EXECUTE FUNCTION catwalks_search_posting_changed();
CREATE TRIGGER catwalks_search_direct_country AFTER UPDATE OF "countryCode" ON "DirectOffer"
 FOR EACH ROW WHEN (NEW."countryCode" IS DISTINCT FROM OLD."countryCode") EXECUTE FUNCTION catwalks_search_posting_changed();
COMMIT;
