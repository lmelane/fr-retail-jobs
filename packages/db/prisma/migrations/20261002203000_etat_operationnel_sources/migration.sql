-- D-520 : l'état opérationnel des sources (apps/aggregator/src/pipeline/sourceState.ts). ADDITIVE : une table neuve,
-- aucune colonne ni ligne existante touchée. Le code d'avant l'ignore ; le code d'après la remplit à chaque collecte.
CREATE TABLE "SourceOperationalState" (
  "sourceKey" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "cause" TEXT,
  "trajectory" TEXT,
  "missing" TEXT,
  "since" TIMESTAMP(3) NOT NULL,
  "deadline" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "escalated" BOOLEAN NOT NULL DEFAULT false,
  "decision" TEXT,
  "codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "lastCollectionAt" TIMESTAMP(3),
  "lastCollectionKind" TEXT,
  "lastRunId" TEXT,
  "computedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceOperationalState_pkey" PRIMARY KEY ("sourceKey"),
  CONSTRAINT "SourceOperationalState_state_check" CHECK ("state" IN ('NORMALE','DEGRADEE','EN_ATTENTE','BLOQUEE','EN_PAUSE','EXCLUE')),
  CONSTRAINT "SourceOperationalState_trajectory_check" CHECK ("trajectory" IS NULL OR "trajectory" IN ('AUTO','A_REPARER','REVUE_HUMAINE','DECISION')),
  CONSTRAINT "SourceOperationalState_kind_check" CHECK ("lastCollectionKind" IS NULL OR "lastCollectionKind" IN ('RUN','PASSE','VERIFICATION')),
  -- Tout état autre que NORMALE porte une cause et une trajectoire (D-520 §2).
  CONSTRAINT "SourceOperationalState_explained_check" CHECK (("state" = 'NORMALE') = ("cause" IS NULL) AND ("cause" IS NULL) = ("trajectory" IS NULL))
);
CREATE INDEX "SourceOperationalState_state_trajectory_idx" ON "SourceOperationalState"("state", "trajectory");
