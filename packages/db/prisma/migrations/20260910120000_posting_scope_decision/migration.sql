-- Reviewed sector-perimeter decision per posting (collection untouched, publication withheld on OUT_OF_SCOPE).
CREATE TABLE "PostingScopeDecision" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostingScopeDecision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PostingScopeDecision_sourceKey_externalId_key" ON "PostingScopeDecision"("sourceKey", "externalId");
CREATE INDEX "PostingScopeDecision_sourceKey_verdict_idx" ON "PostingScopeDecision"("sourceKey", "verdict");
