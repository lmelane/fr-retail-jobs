-- D-520 : la file de revue d'identité d'employeur. Additive : une table neuve, aucune ligne existante touchée.
-- Verrou (release r6, 02/10/2026) : l'index ci-dessous n'est pas concurrent, il prend un verrou SHARE sur
-- "EmployerObservation" (493 778 lignes, 301 Mo) et attend toute écriture en cours. `lock_timeout` borne cette attente :
-- au-delà de 10 s, la migration échoue sans rien écrire ; `prisma migrate resolve --rolled-back` puis relancer.
-- Posé avant toute application en production (vérifié dans _prisma_migrations le 02/10 à 19:37 UTC).
SET lock_timeout = '10s';
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

-- D-520 : l'accord des sources qui ont publié un libellé (règle « même Maison du registre »), lu sans parcours de table.
CREATE INDEX "EmployerObservation_normalizedEmployerName_idx" ON "EmployerObservation"("normalizedEmployerName");
