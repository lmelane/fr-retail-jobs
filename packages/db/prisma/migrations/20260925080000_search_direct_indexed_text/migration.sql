-- The search document of a direct offer now carries its indexed text (`searchText`, written by the aggregator's
-- projection; SEARCH_VERSION search-4, D-455: univers words). A change of that text alone, such as a stock
-- re-projection to a new correspondence version, goes through the same queue. Additive: one trigger, no data change.
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE TRIGGER catwalks_search_direct_text AFTER UPDATE OF "searchText" ON "DirectOffer"
 FOR EACH ROW WHEN (NEW."searchText" IS DISTINCT FROM OLD."searchText") EXECUTE FUNCTION catwalks_search_posting_changed();
COMMIT;
