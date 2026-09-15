ALTER TABLE "JobSource" ADD COLUMN "expiresAt" TIMESTAMP(3), ADD COLUMN "expiryEvidence" JSONB;
CREATE INDEX "JobSource_isActive_expiresAt_idx" ON "JobSource"("isActive", "expiresAt");
