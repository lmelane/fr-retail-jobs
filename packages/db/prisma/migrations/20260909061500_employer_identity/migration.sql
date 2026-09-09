-- AlterEnum
ALTER TYPE "CompanyKind" ADD VALUE 'BRAND';

-- DropForeignKey
ALTER TABLE "CompanyAlias" DROP CONSTRAINT "CompanyAlias_companyId_fkey";

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "parentGroupId" TEXT;

-- AlterTable
ALTER TABLE "CompanyAlias" ADD COLUMN     "normalizedName" TEXT,
ADD COLUMN     "reviewId" TEXT,
ADD COLUMN     "sourceKey" TEXT NOT NULL DEFAULT '*';

-- CreateTable
CREATE TABLE "EmployerIdentityReview" (
    "id" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "planHash" TEXT NOT NULL,
    "reviewedBy" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployerIdentityReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerObservation" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "observationHash" TEXT NOT NULL,
    "rawEmployerName" TEXT NOT NULL,
    "normalizedEmployerName" TEXT NOT NULL,
    "canonicalEmployerId" TEXT,
    "rule" TEXT NOT NULL,
    "aliasId" TEXT,
    "reviewId" TEXT,
    "rawHash" TEXT,
    "pipelineVersion" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployerObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployerObservation_canonicalEmployerId_rule_idx" ON "EmployerObservation"("canonicalEmployerId", "rule");

-- CreateIndex
CREATE INDEX "EmployerObservation_sourceKey_rule_idx" ON "EmployerObservation"("sourceKey", "rule");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerObservation_sourceKey_externalId_observationHash_key" ON "EmployerObservation"("sourceKey", "externalId", "observationHash");

-- CreateIndex
CREATE INDEX "Company_parentGroupId_idx" ON "Company"("parentGroupId");

-- CreateIndex
CREATE INDEX "Company_mergedIntoId_idx" ON "Company"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyAlias_sourceKey_normalizedName_key" ON "CompanyAlias"("sourceKey", "normalizedName");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_parentGroupId_fkey" FOREIGN KEY ("parentGroupId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAlias" ADD CONSTRAINT "CompanyAlias_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyAlias" ADD CONSTRAINT "CompanyAlias_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "EmployerIdentityReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

