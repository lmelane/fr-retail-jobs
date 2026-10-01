-- D-496 — LE RATTRAPAGE DU POINT DES OFFRES, À BLANC : aucune écriture (lecture seule, compatible avec la cible
-- `readonly` de db.py). Ce que l'écriture changerait, et la couverture des offres actives par pays, avant et après.
-- Une seule définition du calcul : `catwalks_geo_rattrapage()` (migration 20261001140000_geo_villes_proximite).
--
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
--     'psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f apps/aggregator/scripts/geo/rattrapage-a-blanc.sql'
\pset footer off
-- La cible `readonly` borne chaque instruction à 25 s ; ces lectures en demandent davantage sur la production.
SET statement_timeout = '5min';

\echo 'Base de villes chargée'
SELECT r."id" AS chargement, r."loadedAt", r."cities" AS villes, r."names" AS noms, r."labels" AS libelles, r."attribution"
  FROM "GeoCityRelease" r ORDER BY r."id" DESC LIMIT 1;

\echo 'Noms ambigus appris des coordonnées natives (exceptions à la règle par nom), les plus portés'
SELECT a."countryCode" AS pays, a."nameKey" AS nom, c."name" AS ville, c."subdivision", a.offers AS offres_natives,
       p."name" AS selon_le_nom, p."subdivision" AS subdivision_selon_le_nom
  FROM catwalks_geo_apprentissage() a JOIN "GeoCity" c ON c."id" = a."cityId"
  LEFT JOIN "GeoCity" p ON p."id" = catwalks_ville_par_nom(ARRAY[a."countryCode"], a."nameKey", NULL)
 ORDER BY a.offers DESC LIMIT 20;

\echo 'Lignes que l''écriture modifierait (offres absorbées exclues)'
SELECT origine, count(*) AS lignes, count(*) FILTER (WHERE actif) AS actives,
       count(*) FILTER (WHERE source = 'NATIVE') AS point_natif, count(*) FILTER (WHERE source = 'CITY') AS point_ville,
       count(*) FILTER (WHERE source IS NULL) AS point_retire
  FROM catwalks_geo_rattrapage() GROUP BY origine ORDER BY origine;

\echo 'Couverture des offres actives par pays : coordonnées natives, point de recherche avant et après, ville rattachée'
WITH r AS MATERIALIZED (SELECT * FROM catwalks_geo_rattrapage() WHERE origine = 'job'),
etat AS (
  SELECT j."countryCode" AS pays,
         catwalks_coordonnees_valides(j."latitude", j."longitude") AS natif,
         j."geoLatitude" IS NOT NULL AS point_avant,
         CASE WHEN r."id" IS NOT NULL THEN r.latitude IS NOT NULL ELSE j."geoLatitude" IS NOT NULL END AS point_apres,
         CASE WHEN r."id" IS NOT NULL THEN r."cityId" IS NOT NULL ELSE j."geoCityId" IS NOT NULL END AS ville_apres,
         j."city" IS NOT NULL AS ville_renseignee
    FROM "Job" j LEFT JOIN r ON r."id" = j."id"
   WHERE j."isActive" AND j."mergedIntoId" IS NULL
)
SELECT coalesce(pays, '(sans pays)') AS pays, count(*) AS actives,
       round(100.0 * count(*) FILTER (WHERE natif) / count(*), 1) AS pct_coord_natives,
       round(100.0 * count(*) FILTER (WHERE point_avant) / count(*), 1) AS pct_point_avant,
       round(100.0 * count(*) FILTER (WHERE point_apres) / count(*), 1) AS pct_point_apres,
       round(100.0 * count(*) FILTER (WHERE ville_renseignee) / count(*), 1) AS pct_ville_renseignee,
       round(100.0 * count(*) FILTER (WHERE ville_apres) / count(*), 1) AS pct_ville_rattachee
  FROM etat GROUP BY pays ORDER BY count(*) DESC;

\echo 'Les villes d''offres actives que la base ne reconnaît pas (les plus portées)'
SELECT j."countryCode" AS pays, j."city" AS ville, count(*) AS offres
  FROM "Job" j
 WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."city" IS NOT NULL AND j."countryCode" IS NOT NULL
   AND NOT catwalks_coordonnees_valides(j."latitude", j."longitude")
   AND catwalks_ville_resolue(ARRAY[j."countryCode"], j."city", j."adminArea1") IS NULL
 GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30;
