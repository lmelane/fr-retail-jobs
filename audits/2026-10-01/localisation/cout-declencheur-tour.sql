-- D-496 — un tour de mesure (base JETABLE) : INSERT de 90 000 offres, UPDATE d'observation, UPDATE de 10 % déplacées.
\timing on
SET statement_timeout = 0;
\echo '== INSERT 90 000'
INSERT INTO "Job" (id, "companyId", "externalId", source, title, url, "updatedAt", "isActive", "countryCode", city, "adminArea1", latitude, longitude)
SELECT id, 'cout-maison', id, 'GENERIC_JSONLD', 'Conseiller de vente', 'https://example.com/'||id, now(), true, pays, ville, indice, lat, lon FROM cout_offres;
\echo '== UPDATE observation (ville réécrite à l identique) 90 000'
UPDATE "Job" SET "lastSeenAt" = now(), city = city, "countryCode" = "countryCode", latitude = latitude WHERE id LIKE 'cout-%';
\echo '== UPDATE 10 % déplacées'
UPDATE "Job" j SET city = 'Lyon', "countryCode" = 'FR', "adminArea1" = NULL, latitude = NULL, longitude = NULL WHERE id LIKE 'cout-%' AND (substr(id, 6)::int % 10) = 0;
\timing off
SELECT "geoSource", count(*) FROM "Job" WHERE id LIKE 'cout-%' GROUP BY 1 ORDER BY 1;
DELETE FROM "JobSource" WHERE "jobId" LIKE 'cout-%';
DELETE FROM "Job" WHERE id LIKE 'cout-%';
