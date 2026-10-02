-- R-143 §11, D-515 §5, D-516 §2 (02/10/2026) : la photographie de couverture de chaque RUN. ADDITIVE : une table
-- neuve, vide ; aucune ligne existante n'est touchée, aucun verrou long.
--
-- Une ligne par RUN et par entité : Maison (société canonique), marché (code de marché ouvert) ou source (une source
-- qualifiée qui ne sert rien). `served` = offres servies au candidat à la fin de la revue de disponibilité du RUN ;
-- `reference` = médiane des RUN précédents qui a servi à la comparaison ; `cause` et `gravity` = l'alerte posée ce
-- RUN-là pour l'entité (null : aucune). Le RUN suivant lit cette table pour sa référence et pour savoir si une alerte
-- est nouvelle ou en cours (`apps/aggregator/src/coverage/`). Écrite seulement par la revue de couverture du RUN.
SET lock_timeout = '5s';

CREATE TABLE "CoverageSnapshot" (
  "id" TEXT NOT NULL,
  "runId" TEXT,
  "takenAt" TIMESTAMP(3) NOT NULL,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "served" INTEGER NOT NULL,
  "reference" INTEGER,
  "cause" TEXT,
  "gravity" TEXT,
  CONSTRAINT "CoverageSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CoverageSnapshot_scope_check" CHECK ("scope" IN ('MAISON','MARCHE','SOURCE')),
  CONSTRAINT "CoverageSnapshot_served_check" CHECK ("served" >= 0 AND ("reference" IS NULL OR "reference" >= 0)),
  CONSTRAINT "CoverageSnapshot_gravity_check" CHECK (("cause" IS NULL) = ("gravity" IS NULL)
    AND ("gravity" IS NULL OR "gravity" IN ('A_REPARER','A_VERIFIER','INFORMATION')))
);
CREATE UNIQUE INDEX "CoverageSnapshot_takenAt_scope_key_key" ON "CoverageSnapshot"("takenAt", "scope", "key");
CREATE INDEX "CoverageSnapshot_scope_key_takenAt_idx" ON "CoverageSnapshot"("scope", "key", "takenAt");
