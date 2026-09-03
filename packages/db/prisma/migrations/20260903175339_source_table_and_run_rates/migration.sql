-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('DRAFT', 'VALIDATED', 'ACTIVE', 'PAUSED', 'RETIRED');

-- AlterTable
ALTER TABLE "SourceRun" ADD COLUMN     "countryRate" DOUBLE PRECISION,
ADD COLUMN     "dateRate" DOUBLE PRECISION,
ADD COLUMN     "descriptionRate" DOUBLE PRECISION,
ADD COLUMN     "urlRate" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "maison" TEXT NOT NULL,
    "careersDomain" TEXT,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "jobUrlPattern" TEXT,
    "status" "SourceStatus" NOT NULL DEFAULT 'DRAFT',
    "tier" TEXT NOT NULL,
    "tenantKey" TEXT NOT NULL,
    "robotsVerdict" TEXT,
    "robotsCheckedAt" TIMESTAMP(3),
    "verifiedJobCount" INTEGER,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "lastRunJobs" INTEGER,
    "descriptionRate" DOUBLE PRECISION,
    "dateRate" DOUBLE PRECISION,
    "countryRate" DOUBLE PRECISION,
    "urlRate" DOUBLE PRECISION,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_key_key" ON "Source"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Source_tenantKey_key" ON "Source"("tenantKey");

-- CreateIndex
CREATE INDEX "Source_status_idx" ON "Source"("status");

-- CreateIndex
CREATE INDEX "Source_kind_idx" ON "Source"("kind");
