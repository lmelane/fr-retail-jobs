-- Lot 7 — reprise du stock : le texte déjà concaténé est normalisé sur place (aucune jointure, aucun
-- verrou exclusif de table). Séparée de la DDL comme la reprise de la migration 20260909040000.
UPDATE "Job" SET "searchText" = catwalks_normaliser_texte("searchText") WHERE "searchText" <> catwalks_normaliser_texte("searchText");
UPDATE "DirectOffer" SET "searchText" = catwalks_normaliser_texte("searchText") WHERE "searchText" <> catwalks_normaliser_texte("searchText");
