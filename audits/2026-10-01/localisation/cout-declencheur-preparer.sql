-- D-496 — coût des déclencheurs du point, préparation (base JETABLE portant la base de villes complète) : 90 000 lieux
-- d'offres synthétiques. Puis cout-declencheur-tour.sql, déclencheurs désactivés puis actifs, en tours alternés.
\timing off
\pset footer off
SET statement_timeout = 0;
INSERT INTO "Company" (id, name, "canonicalKey", "fashionjobsUrl", "updatedAt") VALUES ('cout-maison','cout-maison','cout-maison','resolved:cout-maison', now()) ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS cout_pool; DROP TABLE IF EXISTS cout_offres;
CREATE TABLE cout_pool AS SELECT row_number() OVER (ORDER BY population DESC) AS n, * FROM "GeoCity"
 WHERE "countryCode" IN ('FR','US','GB','DE','IT','ES','CA','CN','CH','AU','NL','JP','BE','AE') AND suggestible ORDER BY population DESC LIMIT 20000;
-- 90 000 lieux d'offres : 40 % avec coordonnées natives, des formes variées du nom, 9 % de lieux inconnus.
CREATE TABLE cout_offres AS
SELECT 'cout-'||g AS id, p."countryCode" AS pays,
  CASE WHEN g % 11 = 0 THEN 'Zz'||g WHEN g % 7 = 0 THEN lower(p.name) WHEN g % 7 = 1 AND p."admin1Name" IS NOT NULL THEN p.name||', '||p."admin1Name" ELSE p.name END AS ville,
  CASE WHEN p."countryCode" = 'US' AND g % 3 = 0 THEN p."admin1Code" END AS indice,
  CASE WHEN g % 10 < 4 THEN p.latitude + (random()-0.5)/50 END AS lat,
  CASE WHEN g % 10 < 4 THEN p.longitude + (random()-0.5)/50 END AS lon
FROM generate_series(1, 90000) g JOIN cout_pool p ON p.n = 1 + (g * 7919) % 20000;
ANALYZE cout_offres;
\echo 'offres préparées'
SELECT count(*), count(*) FILTER (WHERE lat IS NOT NULL) AS natives FROM cout_offres;
