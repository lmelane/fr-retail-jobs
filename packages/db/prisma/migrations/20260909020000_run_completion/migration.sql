BEGIN;
SET LOCAL lock_timeout = '2s';

ALTER TABLE "SourceRun" ADD COLUMN "complete" BOOLEAN;

COMMIT;
