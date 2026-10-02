-- D-520 : la file de revue d'identité d'employeur. Additive : une table neuve, aucune ligne existante touchée.
CREATE TABLE "EmployerIdentityQueue" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "motif" TEXT NOT NULL,
    "normalizedLabel" TEXT NOT NULL,
    "proposedKey" TEXT NOT NULL DEFAULT '',
    "rawLabel" TEXT NOT NULL,
    "proposedName" TEXT,
    "offers" INTEGER NOT NULL,
    "sampleExternalIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingProof" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCaptureBatchId" TEXT,
    "collections" INTEGER NOT NULL DEFAULT 1,
    "escalateAt" TIMESTAMP(3) NOT NULL,
    "escalatedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "EmployerIdentityQueue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployerIdentityQueue_entry_key" ON "EmployerIdentityQueue"("sourceKey", "motif", "normalizedLabel", "proposedKey");
CREATE INDEX "EmployerIdentityQueue_open_idx" ON "EmployerIdentityQueue"("resolvedAt", "escalateAt");
