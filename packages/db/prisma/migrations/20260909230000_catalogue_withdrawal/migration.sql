ALTER TABLE "Job" ADD COLUMN "withdrawnAt" TIMESTAMP(3),
  ADD COLUMN "withdrawalReason" TEXT;

-- Additive: existing history is not guessed or rewritten by the migration.
ALTER TABLE "Job" ADD CONSTRAINT "Job_withdrawal_state_check" CHECK (
  ("withdrawnAt" IS NULL AND "withdrawalReason" IS NULL)
  OR ("withdrawnAt" IS NOT NULL AND "withdrawalReason" IS NOT NULL
      AND length(trim("withdrawalReason")) > 0 AND NOT "isActive" AND "closedAt" IS NULL)
);
