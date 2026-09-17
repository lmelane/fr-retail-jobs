-- Operational settings are separate from stable portal configuration.
ALTER TABLE "CaptureBatch" ADD COLUMN "executionBudget" JSONB;
ALTER TABLE "CaptureBatch" ADD CONSTRAINT "CaptureBatch_executionBudget_shape" CHECK
  ("executionBudget" IS NULL OR jsonb_typeof("executionBudget")='object');
-- The sole rotating offer reader was FashionJobs, withdrawn from postings.
-- This obsolete resume pointer is not publication evidence or source RAW.
DROP TABLE "SourceCursor";
