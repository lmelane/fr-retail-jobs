-- RÉTENTION DES OBSERVATIONS — décision propriétaire du 2026-09-13.
--
-- P8 a mesuré la seule borne de capacité franche : `SourceObservation` croît d'une ligne par offre et par
-- passage, sans purge (~13,2 Go/mois de passes quotidiennes sur une base de 3,35 Go).
--
-- Cette migration n'ARCHIVE ni ne SUPPRIME rien. Elle pose les structures qui rendent une purge sûre :
-- la métadonnée d'audit qui survit à la suppression, et le manifeste immuable des archives.
-- Rollback : DROP des deux tables + DROP de l'index. Aucune donnée existante n'est touchée.

-- Balayage par date : sans lui, la sélection des lignes éligibles scanne toute la table.
CREATE INDEX IF NOT EXISTS "SourceObservation_observedAt_idx" ON "SourceObservation"("observedAt");

-- Ce qui SURVIT à la purge : sans cette table, une observation supprimée disparaîtrait en silence.
CREATE TABLE IF NOT EXISTS "ObservationArchiveRef" (
  "id" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "runId" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "contentHash" TEXT NOT NULL,
  "disposition" TEXT NOT NULL,
  "canonicalSetRef" TEXT,
  "archiveUri" TEXT NOT NULL,
  "archiveSha256" TEXT NOT NULL,
  "archiveFormatVersion" INTEGER NOT NULL,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObservationArchiveRef_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ObservationArchiveRef_sourceKey_externalId_contentHash_key"
  ON "ObservationArchiveRef"("sourceKey", "externalId", "contentHash");
CREATE INDEX IF NOT EXISTS "ObservationArchiveRef_archiveUri_idx" ON "ObservationArchiveRef"("archiveUri");
CREATE INDEX IF NOT EXISTS "ObservationArchiveRef_observedAt_idx" ON "ObservationArchiveRef"("observedAt");

-- Le manifeste : ce qu'on peut affirmer d'une archive sans la relire entièrement.
CREATE TABLE IF NOT EXISTS "ObservationArchiveManifest" (
  "id" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "sha256" TEXT NOT NULL,
  "formatVersion" INTEGER NOT NULL,
  "archiveUri" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObservationArchiveManifest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ObservationArchiveManifest_day_runId_sourceKey_key"
  ON "ObservationArchiveManifest"("day", "runId", "sourceKey");
CREATE INDEX IF NOT EXISTS "ObservationArchiveManifest_createdAt_idx" ON "ObservationArchiveManifest"("createdAt");
