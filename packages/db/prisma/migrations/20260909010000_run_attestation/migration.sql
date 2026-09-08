BEGIN;
SET LOCAL lock_timeout = '2s';

ALTER TABLE "SourceRun"
  ADD COLUMN "fetched" INTEGER,
  ADD COLUMN "accepted" INTEGER,
  ADD COLUMN "declaredTotal" INTEGER,
  ADD COLUMN "truncated" BOOLEAN,
  ADD COLUMN "errors" INTEGER,
  ADD COLUMN "canAttestAbsence" BOOLEAN;

-- Historical notes cannot establish that an adapter completed its crawl.
-- Leave legacy evidence NULL: the next measured run supplies the decision.

COMMIT;
