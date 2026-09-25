-- D-444: a direct offer read from the backend's public list is attached to the Company registry (its group feeds the
-- "groupe" filter) and receives the active occupation taxonomy's code for its title (the "metier" filter); both were
-- NULL before, which excluded every Catwalks offer from those two filters. projectionHash lets the 5-minute reader
-- write only what changes. The search document of a direct offer reads its occupation code (role fallback, as for an
-- aggregated offer, SEARCH_VERSION search-4): a change of that code alone goes through the same queue, as it does for
-- "Job"."occupationCode". Additive: four nullable columns, no default, no data change, no index, no constraint, one
-- trigger.
BEGIN;
SET LOCAL lock_timeout='2s';
ALTER TABLE "DirectOffer"
  ADD COLUMN "companyId" TEXT,
  ADD COLUMN "occupationCode" TEXT,
  ADD COLUMN "occupationReleaseId" TEXT,
  ADD COLUMN "projectionHash" TEXT;
CREATE TRIGGER catwalks_search_direct_occupation AFTER UPDATE OF "occupationCode" ON "DirectOffer"
 FOR EACH ROW WHEN (NEW."occupationCode" IS DISTINCT FROM OLD."occupationCode") EXECUTE FUNCTION catwalks_search_posting_changed();
COMMIT;
