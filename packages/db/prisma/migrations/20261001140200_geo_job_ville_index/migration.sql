-- D-496 : les offres d'une ville de la base (les suggestions de lieu sont rangées par leur nombre d'offres), sur les
-- seules offres actives. Hors transaction (CONCURRENTLY), une instruction par migration.
CREATE INDEX CONCURRENTLY "Job_geo_ville_actif_idx" ON "Job" ("geoCityId") WHERE "isActive" AND "mergedIntoId" IS NULL AND "geoCityId" IS NOT NULL;
