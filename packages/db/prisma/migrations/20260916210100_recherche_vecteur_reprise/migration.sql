-- Lot 7 — reprise du stock : les vecteurs des offres existantes, l'index qui filtre, la fin des trigrammes.
--
-- Coût mesuré sur le clone du stock (87 607 offres) : voir audits/reprise-2026-09-15/lot-7.md. La reprise
-- réécrit chaque ligne de `Job` (déclencheur de redirection différé compris) : à jouer hors des heures de
-- capture, comme la reprise de la normalisation (20260916200100).
-- Les index trigrammes sont retirés : plus aucun chemin ne lit `searchText` par `ILIKE` — le seul
-- `LIKE` restant (écritures sans espaces) porte sur des périmètres de quelques milliers d'offres.
BEGIN;
SET LOCAL lock_timeout = '2s';
-- La reprise réécrit chaque ligne de `Job`, dont le déclencheur de redirection est une contrainte DIFFÉRÉE :
-- ses événements en attente interdiraient ensuite `CREATE INDEX` et `DROP INDEX` sur la table dans la même
-- transaction (« pending trigger events », constaté sur le clone). Rendus immédiats, ils se jouent ligne à ligne.
SET CONSTRAINTS ALL IMMEDIATE;

UPDATE "Job" j
   SET "searchVector" = catwalks_vecteur_texte(j."searchText"),
       "titleVector" = catwalks_vecteur_titre(j.title, c.name, c."parentGroup")
  FROM "Company" c
 WHERE c.id = j."companyId";

UPDATE "DirectOffer"
   SET "searchVector" = catwalks_vecteur_texte("searchText"),
       "titleVector" = catwalks_vecteur_titre(title, company, NULL);

CREATE INDEX "Job_searchVector_idx" ON "Job" USING gin ("searchVector") WHERE "isActive";

DROP INDEX IF EXISTS "Job_searchText_trgm_idx";
DROP INDEX IF EXISTS "DirectOffer_searchText_trgm_idx";

COMMIT;
