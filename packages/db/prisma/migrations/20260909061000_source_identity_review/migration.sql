CREATE TABLE "SourceIdentityReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceKey" TEXT NOT NULL,
  "tenantKey" TEXT NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "verdict" TEXT NOT NULL CHECK ("verdict" IN ('VERIFIED', 'CONTRADICTED', 'UNRESOLVED')),
  "method" TEXT NOT NULL CHECK ("method" IN ('OFFICIAL_LINK', 'OFFICIAL_DOMAIN', 'GROUP_DOCUMENT')),
  "officialDomain" TEXT NOT NULL,
  "proofUrl" TEXT NOT NULL,
  "portalUrl" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "artifactHash" TEXT NOT NULL,
  "reviewer" TEXT NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceIdentityReview_sourceKey_fkey" FOREIGN KEY ("sourceKey") REFERENCES "Source"("key") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "SourceIdentityReview_sourceKey_createdAt_idx" ON "SourceIdentityReview"("sourceKey", "createdAt");
CREATE TRIGGER source_identity_review_immutable BEFORE UPDATE OR DELETE ON "SourceIdentityReview"
FOR EACH ROW EXECUTE FUNCTION prevent_correction_evidence_mutation();
