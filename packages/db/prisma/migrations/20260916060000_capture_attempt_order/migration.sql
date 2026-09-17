BEGIN;
-- Historical ordering was never recorded. Leave old captures explicitly null;
-- only future attempts receive an ordinal, before any native collection begins.
CREATE SEQUENCE "CaptureBatch_attemptOrdinal_seq" AS BIGINT;
ALTER TABLE "CaptureBatch" ADD COLUMN "attemptOrdinal" BIGINT;
ALTER TABLE "CaptureBatch" ALTER COLUMN "attemptOrdinal" SET DEFAULT nextval('"CaptureBatch_attemptOrdinal_seq"'::regclass);
ALTER SEQUENCE "CaptureBatch_attemptOrdinal_seq" OWNED BY "CaptureBatch"."attemptOrdinal";
CREATE UNIQUE INDEX "CaptureBatch_attemptOrdinal_key" ON "CaptureBatch"("attemptOrdinal");
DROP INDEX "CaptureBatch_sourceRevisionId_startedAt_idx";
CREATE INDEX "CaptureBatch_sourceRevisionId_attemptOrdinal_idx" ON "CaptureBatch"("sourceRevisionId","attemptOrdinal");
COMMIT;
