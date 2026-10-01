-- D-496 : la boîte englobante d'une recherche de proximité (pays, puis latitude et longitude du point de recherche),
-- sur les seules offres actives. Hors transaction (CONCURRENTLY) : l'application reste lisible et inscriptible
-- pendant la construction. Une instruction par migration, sinon Prisma l'enveloppe dans une transaction implicite.
CREATE INDEX CONCURRENTLY "Job_geo_point_actif_idx" ON "Job" ("countryCode", "geoLatitude", "geoLongitude") WHERE "isActive" AND "mergedIntoId" IS NULL AND "geoLatitude" IS NOT NULL;
