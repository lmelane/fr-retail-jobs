BEGIN;
-- Qualification is derived from immutable native captures, not an operator count.
ALTER TABLE "Source" DROP COLUMN "verifiedJobCount";
COMMIT;
