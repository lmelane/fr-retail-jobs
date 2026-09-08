-- Géographie mondiale : ajout de `adminArea1` / `adminArea2`.
--
-- Mesuré le 2026-09-08 : `state` (11 688 offres), `regionState` (4 631) et
-- `region` (422) portaient une subdivision administrative qui n'avait aucune
-- colonne pour l'accueillir. Elle vivait dans le raw, invisible aux filtres.
--
-- `adminArea2` reste VIDE : aucune source du catalogue ne fournit ce niveau
-- aujourd'hui, et on ne remplit pas une colonne pour la justifier.
--
-- Pas de colonne `continent` : « Europe », « Asia Pacific » (le champ
-- `geographicArea`) sont des macro-régions business, dérivables du pays.
--
-- `country` n'est PAS renommé en `countryCode` : la colonne stocke DÉJÀ des
-- codes ISO, le renommage toucherait 113 usages sur 35 fichiers pour un gain
-- purement nominal — à la différence de `contract`, qui portait une erreur de
-- concept. Décision à prendre séparément.
--
-- ROLLBACK : ALTER TABLE "Job" DROP COLUMN "adminArea1", DROP COLUMN "adminArea2";

ALTER TABLE "Job"
  ADD COLUMN "adminArea1" TEXT,
  ADD COLUMN "adminArea2" TEXT;

-- Index sur la seule dimension qui sera filtrée : `adminArea2` restant vide,
-- l'indexer coûterait sans rien servir.
CREATE INDEX "Job_adminArea1_idx" ON "Job"("adminArea1");
