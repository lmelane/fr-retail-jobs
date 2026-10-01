-- Mesure en lecture seule, 01/10/2026 : couverture des coordonnées et forme des villes (D-495, proximité).
\pset footer off
SELECT "countryCode" AS marche, count(*) AS actives,
       round(100.0*count(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL)/count(*),1) AS pct_coord,
       round(100.0*count(*) FILTER (WHERE "postalCode" IS NOT NULL)/count(*),1) AS pct_cp,
       round(100.0*count(*) FILTER (WHERE city IS NOT NULL)/count(*),1) AS pct_ville
FROM "Job" WHERE "isActive" AND "mergedIntoId" IS NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 15;
SELECT city, count(*) FROM "Job" WHERE "isActive" AND "mergedIntoId" IS NULL AND "countryCode"='FR' AND unaccent(lower(city)) LIKE 'paris%' GROUP BY 1 ORDER BY 2 DESC LIMIT 15;
SELECT count(*) AS offres_a_10km_chennevieres FROM "Job" WHERE "isActive" AND "mergedIntoId" IS NULL AND latitude IS NOT NULL
  AND 6371*2*asin(sqrt(power(sin(radians(latitude-48.7975)/2),2)+cos(radians(48.7975))*cos(radians(latitude))*power(sin(radians(longitude-2.5397)/2),2))) < 10;
SELECT count(*) AS offres_ville_chennevieres FROM "Job" WHERE "isActive" AND "mergedIntoId" IS NULL AND unaccent(lower(city)) LIKE 'chennevi%';
