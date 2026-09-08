-- RENOMMAGE ATOMIQUE `Job.country` → `Job.countryCode`, + `countryIntegrity`.
--
-- La colonne ne stocke plus un « pays » libre depuis les normalisations
-- d'écriture : elle stocke un code ISO 3166-1 alpha-2 canonique (FR, US, GB…).
-- Son nom décrit désormais sa sémantique. Renommage ATOMIQUE, comme pour
-- `contract` : pas de dual-write, pas de colonne parallèle, pas de bascule.
--
-- `RENAME COLUMN` préserve les données ET l'index : aucune ligne n'est réécrite,
-- aucune valeur ne peut être perdue.
--
-- Ce qui n'est PAS renommé, volontairement (décision Loïc) :
--   · `JobEvent.field` peut valoir la chaîne 'country' — c'est le nom LOGIQUE
--     d'une dimension, pas la colonne ; réécrire l'historique pour harmoniser
--     un nom technique serait falsifier une série.
--   · `MarketSnapshot.scope = 'country'` — même raison.
--   · `Source.countryRate` — un taux de qualité, sans rapport.
--
-- `countryIntegrity` : marque une valeur CONSERVÉE mais douteuse. Mesuré le
-- 2026-09-08 : 543 offres dont le code stocké collisionne avec une subdivision
-- (« Los Angeles, CA » = Californie, « Toronto, CA » = Canada — les deux
-- existent en base sous `CA`) et dont la ville n'est attestée nulle part sous
-- ce pays. On ne corrige pas sans preuve ; on signale.
--
-- ROLLBACK :
--   ALTER TABLE "Job" RENAME COLUMN "countryCode" TO "country";
--   ALTER INDEX "Job_isActive_countryCode_idx" RENAME TO "Job_isActive_country_idx";
--   ALTER TABLE "Job" DROP COLUMN "countryIntegrity";

ALTER TABLE "Job" RENAME COLUMN "country" TO "countryCode";

ALTER INDEX "Job_isActive_country_idx" RENAME TO "Job_isActive_countryCode_idx";

ALTER TABLE "Job" ADD COLUMN "countryIntegrity" TEXT;
