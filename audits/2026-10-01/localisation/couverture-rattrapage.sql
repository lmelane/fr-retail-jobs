-- D-496 — LA COUVERTURE OBTENUE PAR LE RATTRAPAGE, mesurée sur une base JETABLE (migrations appliquées, base de villes
-- chargée par villes.py), à partir de l'export en lecture seule de la production (export-offres-geo.sql). Même règle
-- que `catwalks_geo_rattrapage()` : coordonnées natives valides, sinon le centre de la ville résolue.
--   psql <base jetable> -X -v ON_ERROR_STOP=1 -v fichier=<chemin de offres-geo.tsv> -f couverture-rattrapage.sql
\pset footer off
CREATE TEMP TABLE offres (id text, pays text, ville text, indice text, lat float8, lon float8, actif boolean);
\set copie '\\copy offres FROM ' :'fichier'
:copie
CREATE TEMP TABLE resolues AS
  SELECT k.pays, k.ville, k.indice, catwalks_ville_resolue(ARRAY[k.pays], k.ville, k.indice) AS ville_id
    FROM (SELECT DISTINCT pays, ville, indice FROM offres WHERE pays IS NOT NULL AND ville IS NOT NULL) k;
CREATE TEMP TABLE etat AS
  SELECT o.*, r.ville_id, catwalks_coordonnees_valides(o.lat, o.lon) AS natif, c.latitude AS vlat, c.longitude AS vlon
    FROM offres o
    LEFT JOIN resolues r ON r.pays = o.pays AND r.ville = o.ville AND r.indice IS NOT DISTINCT FROM o.indice
    LEFT JOIN "GeoCity" c ON c.id = r.ville_id;

\echo 'Couverture des offres actives par pays (marché) : coordonnées natives avant, point de recherche après'
SELECT coalesce(pays, '(sans pays)') AS pays, count(*) AS actives,
       round(100.0 * count(*) FILTER (WHERE natif) / count(*), 1) AS pct_avant,
       round(100.0 * count(*) FILTER (WHERE natif OR ville_id IS NOT NULL) / count(*), 1) AS pct_apres,
       round(100.0 * count(*) FILTER (WHERE ville IS NOT NULL) / count(*), 1) AS pct_ville_renseignee,
       round(100.0 * count(*) FILTER (WHERE ville_id IS NOT NULL) / count(*), 1) AS pct_ville_rattachee
  FROM etat WHERE actif GROUP BY pays ORDER BY count(*) DESC LIMIT 30;

\echo 'Ensemble des offres actives'
SELECT count(*) AS actives, round(100.0 * count(*) FILTER (WHERE natif) / count(*), 1) AS pct_avant,
       round(100.0 * count(*) FILTER (WHERE natif OR ville_id IS NOT NULL) / count(*), 1) AS pct_apres
  FROM etat WHERE actif;

\echo 'Justesse du rattachement : distance entre les coordonnées natives et le centre de la ville rattachée (offres actives qui ont les deux)'
SELECT pays, count(*) AS offres,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY d)::numeric, 1) AS mediane_km,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY d)::numeric, 1) AS p95_km,
       count(*) FILTER (WHERE d > 30) AS plus_de_30_km
  FROM (SELECT pays, 6371.0088 * 2 * asin(least(1, sqrt(power(sin(radians(lat - vlat) / 2), 2)
          + cos(radians(vlat)) * cos(radians(lat)) * power(sin(radians(lon - vlon) / 2), 2)))) AS d
          FROM etat WHERE actif AND natif AND ville_id IS NOT NULL) x
 GROUP BY pays ORDER BY count(*) DESC LIMIT 15;

\echo 'Les rattachements les plus éloignés des coordonnées natives (à relire)'
SELECT e.pays, e.ville, e.indice, c.name AS ville_base, c.subdivision, count(*) AS offres,
       round(min(6371.0088 * 2 * asin(least(1, sqrt(power(sin(radians(e.lat - c.latitude) / 2), 2)
          + cos(radians(c.latitude)) * cos(radians(e.lat)) * power(sin(radians(e.lon - c.longitude) / 2), 2)))))::numeric) AS km
  FROM etat e JOIN "GeoCity" c ON c.id = e.ville_id
 WHERE e.actif AND e.natif
 GROUP BY 1, 2, 3, 4, 5
HAVING min(6371.0088 * 2 * asin(least(1, sqrt(power(sin(radians(e.lat - c.latitude) / 2), 2)
          + cos(radians(c.latitude)) * cos(radians(e.lat)) * power(sin(radians(e.lon - c.longitude) / 2), 2))))) > 50
 ORDER BY count(*) DESC LIMIT 25;

\echo 'Villes d''offres actives sans point après rattrapage (les plus portées)'
SELECT pays, ville, count(*) AS offres FROM etat
 WHERE actif AND NOT natif AND ville_id IS NULL GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 30;
