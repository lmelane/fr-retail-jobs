-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CompanyKind" AS ENUM ('UNKNOWN', 'MAISON', 'GROUP', 'RETAILER', 'AGENCY', 'RECRUITER', 'MEDIA', 'SUPPLIER', 'OTHER');

-- CreateEnum
CREATE TYPE "CompanySector" AS ENUM ('UNKNOWN', 'FASHION', 'LUXURY', 'BEAUTY', 'JEWELRY_WATCHES', 'RETAIL', 'SUPPLIER', 'MEDIA_AGENCY', 'RECRUITER', 'OTHER');

-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('PENDING', 'FOUND', 'NEEDS_REVIEW', 'UNSUPPORTED', 'ERROR');

-- CreateEnum
CREATE TYPE "AtsType" AS ENUM ('PINPOINT', 'LVMH_ALGOLIA', 'MAGNET', 'TALENTVIEW', 'EIGHTFOLD', 'AVATURE', 'TEAMTAILOR', 'DIGITALRECRUITERS', 'TALENTSOFT', 'PHENOM', 'SUCCESSFACTORS', 'WTTJ', 'ASHBY', 'WORKABLE', 'GREENHOUSE', 'LEVER', 'SMARTRECRUITERS', 'RECRUITEE', 'PERSONIO', 'WORKDAY', 'GENERIC_JSONLD', 'WORDPRESS', 'FASHIONJOBS', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "kind" "CompanyKind" NOT NULL DEFAULT 'UNKNOWN',
    "sector" "CompanySector" NOT NULL DEFAULT 'UNKNOWN',
    "parentGroup" TEXT,
    "fashionjobsUrl" TEXT NOT NULL,
    "fashionjobsSlug" TEXT,
    "fashionjobsOfferCount" INTEGER,
    "careersUrl" TEXT,
    "atsType" "AtsType" NOT NULL DEFAULT 'UNKNOWN',
    "atsConfig" JSONB,
    "discoveryStatus" "DiscoveryStatus" NOT NULL DEFAULT 'PENDING',
    "discoveryNote" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAtsDiscoveryAt" TIMESTAMP(3),
    "lastJobSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyAlias" (
    "id" TEXT NOT NULL,
    "aliasKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobSource" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceTier" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "postedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,

    CONSTRAINT "JobSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "source" "AtsType" NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "country" TEXT,
    "isFrance" BOOLEAN NOT NULL DEFAULT false,
    "city" TEXT,
    "postalCode" TEXT,
    "inseeCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "contract" TEXT,
    "workingTime" TEXT,
    "remote" TEXT,
    "experienceYears" INTEGER,
    "educationLevel" TEXT,
    "salaryMin" INTEGER,
    "salaryMax" INTEGER,
    "salaryCurrency" TEXT,
    "salaryPeriod" TEXT,
    "department" TEXT,
    "validThrough" TIMESTAMP(3),
    "description" TEXT,
    "language" TEXT,
    "url" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "fingerprint" TEXT NOT NULL,
    "pipelineVersion" INTEGER NOT NULL DEFAULT 0,
    "clusterKey" TEXT,
    "canonicalTier" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeoCache" (
    "id" TEXT NOT NULL,
    "queryKey" TEXT NOT NULL,
    "city" TEXT,
    "postalCode" TEXT,
    "inseeCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRun" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "jobs" INTEGER NOT NULL,
    "previousJobs" INTEGER,
    "note" TEXT,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceCursor" (
    "sourceKey" TEXT NOT NULL,
    "nextPage" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceCursor_pkey" PRIMARY KEY ("sourceKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_fashionjobsUrl_key" ON "Company"("fashionjobsUrl");

-- CreateIndex
CREATE INDEX "Company_sector_idx" ON "Company"("sector");

-- CreateIndex
CREATE INDEX "Company_canonicalKey_idx" ON "Company"("canonicalKey");

-- CreateIndex
CREATE INDEX "Company_discoveryStatus_idx" ON "Company"("discoveryStatus");

-- CreateIndex
CREATE INDEX "Company_atsType_idx" ON "Company"("atsType");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyAlias_aliasKey_key" ON "CompanyAlias"("aliasKey");

-- CreateIndex
CREATE INDEX "JobSource_jobId_idx" ON "JobSource"("jobId");

-- CreateIndex
CREATE INDEX "JobSource_sourceKey_isActive_idx" ON "JobSource"("sourceKey", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "JobSource_sourceKey_externalId_key" ON "JobSource"("sourceKey", "externalId");

-- CreateIndex
CREATE INDEX "Job_clusterKey_idx" ON "Job"("clusterKey");

-- CreateIndex
CREATE INDEX "Job_department_idx" ON "Job"("department");

-- CreateIndex
CREATE INDEX "Job_contract_idx" ON "Job"("contract");

-- CreateIndex
CREATE INDEX "Job_isFrance_isActive_idx" ON "Job"("isFrance", "isActive");

-- CreateIndex
CREATE INDEX "Job_fingerprint_idx" ON "Job"("fingerprint");

-- CreateIndex
CREATE INDEX "Job_companyId_isActive_idx" ON "Job"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "Job_isFrance_isActive_latitude_longitude_idx" ON "Job"("isFrance", "isActive", "latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "Job_companyId_source_externalId_key" ON "Job"("companyId", "source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "GeoCache_queryKey_key" ON "GeoCache"("queryKey");

-- CreateIndex
CREATE INDEX "GeoCache_resolved_idx" ON "GeoCache"("resolved");

-- CreateIndex
CREATE INDEX "SourceRun_sourceKey_ranAt_idx" ON "SourceRun"("sourceKey", "ranAt");

-- CreateIndex
CREATE INDEX "SourceRun_status_ranAt_idx" ON "SourceRun"("status", "ranAt");

-- AddForeignKey
ALTER TABLE "CompanyAlias" ADD CONSTRAINT "CompanyAlias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobSource" ADD CONSTRAINT "JobSource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

