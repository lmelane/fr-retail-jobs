-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "isAiRelated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isRetail" BOOLEAN,
ADD COLUMN     "jobFunction" TEXT,
ADD COLUMN     "reopenedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "seniority" TEXT,
ADD COLUMN     "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "taxonomyVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "field" TEXT,
    "before" TEXT,
    "after" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "activeJobs" INTEGER NOT NULL,
    "newJobs" INTEGER NOT NULL,
    "closedJobs" INTEGER NOT NULL,
    "hiringCompanies" INTEGER NOT NULL,
    "medianLifespanDays" DOUBLE PRECISION,
    "reopenedJobs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobEvent_jobId_at_idx" ON "JobEvent"("jobId", "at");

-- CreateIndex
CREATE INDEX "JobEvent_type_at_idx" ON "JobEvent"("type", "at");

-- CreateIndex
CREATE INDEX "MarketSnapshot_scope_key_date_idx" ON "MarketSnapshot"("scope", "key", "date");

-- CreateIndex
CREATE INDEX "MarketSnapshot_date_scope_idx" ON "MarketSnapshot"("date", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSnapshot_date_scope_key_key" ON "MarketSnapshot"("date", "scope", "key");

-- CreateIndex
CREATE INDEX "Job_isActive_country_idx" ON "Job"("isActive", "country");

-- CreateIndex
CREATE INDEX "Job_isActive_jobFunction_idx" ON "Job"("isActive", "jobFunction");

-- CreateIndex
CREATE INDEX "Job_isActive_seniority_idx" ON "Job"("isActive", "seniority");

-- CreateIndex
CREATE INDEX "Job_firstSeenAt_idx" ON "Job"("firstSeenAt");

-- CreateIndex
CREATE INDEX "Job_closedAt_idx" ON "Job"("closedAt");

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

