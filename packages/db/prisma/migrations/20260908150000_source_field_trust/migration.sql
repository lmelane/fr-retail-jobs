-- `sourceFieldTrust` — la fiabilité d'une preuve, mesurée puis jugée.
--
-- Aucune source n'est nommée dans le code : le moteur DÉCOUVRE les champs non
-- fiables par la mesure. PVH est une observation, pas une règle.
--
-- ROLLBACK : DROP TABLE "SourceFieldTrustObservation"; DROP TABLE "SourceFieldTrust";

CREATE TABLE "SourceFieldTrust" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "dimension" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "eligibleCount" INTEGER NOT NULL,
  "agreementCount" INTEGER NOT NULL,
  "contradictionCount" INTEGER NOT NULL,
  "contradictionRate" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL,
  "evaluatorVersion" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceFieldTrust_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceFieldTrust_source_path_dimension_key"
  ON "SourceFieldTrust"("source", "path", "dimension");
CREATE INDEX "SourceFieldTrust_level_idx" ON "SourceFieldTrust"("level");

-- L'historique n'expire jamais : un verdict opérationnel peut retomber à
-- INSUFFICIENT_EVIDENCE, la mémoire du comportement passé reste pour expliquer
-- une dégradation ancienne et détecter une récidive.
CREATE TABLE "SourceFieldTrustObservation" (
  "id" TEXT NOT NULL,
  "trustId" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "eligibleCount" INTEGER NOT NULL,
  "contradictionCount" INTEGER NOT NULL,
  "contradictionRate" DOUBLE PRECISION NOT NULL,
  "evaluatorVersion" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceFieldTrustObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SourceFieldTrustObservation_trustId_recordedAt_idx"
  ON "SourceFieldTrustObservation"("trustId", "recordedAt");

ALTER TABLE "SourceFieldTrustObservation"
  ADD CONSTRAINT "SourceFieldTrustObservation_trustId_fkey"
  FOREIGN KEY ("trustId") REFERENCES "SourceFieldTrust"("id") ON DELETE CASCADE ON UPDATE CASCADE;
