-- Native experience can be fractional (WTTJ: 0.5 years). Preserve the value,
-- and retain the previous integer column's bounds without requiring integers.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE "Job"
  ALTER COLUMN "experienceYears" TYPE DOUBLE PRECISION
  USING "experienceYears"::double precision;
ALTER TABLE "Job" ADD CONSTRAINT "Job_experienceYears_supported_range"
  CHECK ("experienceYears" BETWEEN -2147483648 AND 2147483647);
COMMIT;
