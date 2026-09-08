BEGIN;
SET LOCAL lock_timeout = '2s';

-- JobSource(sourceKey, externalId) is the source identity. ATS family + ID is
-- not unique across tenants. Preserve the lookup index without conflating jobs.
CREATE INDEX "Job_companyId_source_externalId_idx" ON "Job"("companyId", "source", "externalId");
DROP INDEX "Job_companyId_source_externalId_key";
ALTER TABLE "Job" ADD COLUMN "canonicalSourceKey" TEXT, ADD COLUMN "canonicalExternalId" TEXT;

CREATE TABLE "SourceObservation" (
  "id" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "raw" JSONB NOT NULL,
  "pipelineVersion" INTEGER NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceObservation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SourceObservation_sourceKey_externalId_contentHash_key" ON "SourceObservation"("sourceKey", "externalId", "contentHash");
CREATE INDEX "SourceObservation_sourceKey_observedAt_idx" ON "SourceObservation"("sourceKey", "observedAt");

COMMIT;
