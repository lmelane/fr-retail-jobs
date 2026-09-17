-- Preserve existing integer values exactly. Lost historical fractions require
-- a separate evidence-bound RAW replay; this migration never fabricates them.
ALTER TABLE "Job"
  ALTER COLUMN "salaryMin" TYPE NUMERIC(24,6) USING "salaryMin"::NUMERIC(24,6),
  ALTER COLUMN "salaryMax" TYPE NUMERIC(24,6) USING "salaryMax"::NUMERIC(24,6);
