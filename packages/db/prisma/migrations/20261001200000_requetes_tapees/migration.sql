-- D-501 (lot « la recherche comprend la requête », D-500) : ADDITIVE. Une table neuve, vide ; aucune ligne existante
-- n'est touchée, aucun verrou long (création d'une table et de son index sur une table vide).
--
-- LES REQUÊTES TAPÉES, ANONYMES ET AGRÉGÉES (arbitrage du CEO, D-501 §2) : une ligne par marché et par requête
-- normalisée, avec son nombre d'occurrences et deux DATES (jour, sans heure). Aucun identifiant de compte ni
-- d'appareil, aucune adresse IP, aucun horodatage par recherche : rien ne relie une ligne à une personne.
-- Une requête n'est suggérée qu'au-delà d'un seuil d'occurrences ; celles qui restent sous le seuil sont purgées après
-- un délai (`apps/api/lib/requetes-tapees.ts`). Rien ne s'y écrit tant que le site ne transmet pas les requêtes, ce
-- qu'il ne fait qu'avec `REQUETES_TAPEES_ACTIF=1`, posée après la validation juridique (D-501, garde).
SET lock_timeout = '5s';

CREATE TABLE "RequeteTapee" (
  "marche" TEXT NOT NULL,
  "cle" TEXT NOT NULL,
  "libelle" TEXT NOT NULL,
  "occurrences" INTEGER NOT NULL DEFAULT 1,
  "premiereLe" DATE NOT NULL DEFAULT CURRENT_DATE,
  "derniereLe" DATE NOT NULL DEFAULT CURRENT_DATE,
  CONSTRAINT "RequeteTapee_pkey" PRIMARY KEY ("marche", "cle"),
  CONSTRAINT requete_tapee_marche CHECK ("marche" ~ '^[A-Z]{2}$'),
  CONSTRAINT requete_tapee_longueurs CHECK (char_length("cle") BETWEEN 2 AND 80 AND char_length("libelle") BETWEEN 2 AND 80),
  CONSTRAINT requete_tapee_occurrences CHECK ("occurrences" >= 1),
  CONSTRAINT requete_tapee_dates CHECK ("premiereLe" <= "derniereLe")
);
CREATE INDEX "RequeteTapee_marche_occurrences_idx" ON "RequeteTapee"("marche", "occurrences" DESC);
