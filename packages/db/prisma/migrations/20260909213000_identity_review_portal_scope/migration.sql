-- Reviewed portal perimeter for the certified configuration (SINGLE_BRAND | MULTI_BRAND); null when not reviewed.
ALTER TABLE "SourceIdentityReview" ADD COLUMN "portalScope" TEXT;
