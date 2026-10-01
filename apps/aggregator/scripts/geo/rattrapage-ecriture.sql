-- D-496 — LE RATTRAPAGE DU POINT DES OFFRES, ÉCRITURE. Sur GO, hors RUN, après le chargement de la base de villes
-- (villes.py charger --ecrire) et le passage à blanc (rattrapage-a-blanc.sql). Une transaction ; rejouable : un
-- second passage n'écrit rien. Seules les colonnes `geo*` sont écrites : aucun déclencheur de recherche ne se déclenche
-- (ils suivent d'autres colonnes), aucune donnée native n'est touchée.
--
--   python3 apps/aggregator/scripts/ops/db.py production sh -c \
--     'psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f apps/aggregator/scripts/geo/rattrapage-ecriture.sql'
\pset footer off
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- 1. Ce que le catalogue a appris des noms ambigus (« Beverly Hills » sans État) : la table est remplacée par
--    l'apprentissage du jour ; le déclencheur s'en sert pour les offres suivantes, la recherche pour les saisies.
CREATE TEMP TABLE geo_appris ON COMMIT DROP AS SELECT * FROM catwalks_geo_apprentissage();
\echo 'Noms appris'
SELECT count(*) AS noms_appris, coalesce(sum(offers), 0) AS offres_natives FROM geo_appris;

-- 2. Le point des offres, calculé avec cet apprentissage (avant d'écrire la table : même résultat qu'à blanc).
CREATE TEMP TABLE geo_cibles ON COMMIT DROP AS SELECT * FROM catwalks_geo_rattrapage();
CREATE INDEX ON geo_cibles (origine, "id");
\echo 'À écrire'
SELECT origine, count(*) AS lignes, count(*) FILTER (WHERE actif) AS actives FROM geo_cibles GROUP BY origine ORDER BY origine;

DELETE FROM "GeoCityLearned" l
 WHERE NOT EXISTS (SELECT 1 FROM geo_appris a WHERE a."countryCode" = l."countryCode" AND a."nameKey" = l."nameKey");
INSERT INTO "GeoCityLearned" ("countryCode", "nameKey", "cityId", "offers")
SELECT "countryCode", "nameKey", "cityId", offers FROM geo_appris
ON CONFLICT ("countryCode", "nameKey") DO UPDATE SET "cityId" = EXCLUDED."cityId", "offers" = EXCLUDED."offers", "learnedAt" = CURRENT_TIMESTAMP
 WHERE ("GeoCityLearned"."cityId", "GeoCityLearned"."offers") IS DISTINCT FROM (EXCLUDED."cityId", EXCLUDED."offers");

-- Une offre n'est écrite que si sa ville, son pays, sa subdivision et ses coordonnées n'ont pas changé depuis le calcul :
-- une écriture concurrente a déjà recalculé son point par le déclencheur.
UPDATE "Job" j
   SET "geoCityId" = c."cityId", "geoLatitude" = c.latitude, "geoLongitude" = c.longitude, "geoSource" = c.source
  FROM geo_cibles c
 WHERE c.origine = 'job' AND c."id" = j."id"
   AND j."countryCode" IS NOT DISTINCT FROM c.pays AND j."city" IS NOT DISTINCT FROM c.ville
   AND j."adminArea1" IS NOT DISTINCT FROM c.indice
   AND j."latitude" IS NOT DISTINCT FROM c.lat AND j."longitude" IS NOT DISTINCT FROM c.lon;

UPDATE "DirectOffer" d
   SET "geoCityId" = c."cityId", "geoLatitude" = c.latitude, "geoLongitude" = c.longitude, "geoSource" = c.source
  FROM geo_cibles c
 WHERE c.origine = 'direct' AND c."id" = d."id"
   AND d."countryCode" IS NOT DISTINCT FROM c.pays AND d."city" IS NOT DISTINCT FROM c.ville
   AND d."latitude" IS NOT DISTINCT FROM c.lat AND d."longitude" IS NOT DISTINCT FROM c.lon;

\echo 'Reste à rattraper après écriture (attendu : 0, sauf écriture concurrente)'
SELECT count(*) AS reste FROM catwalks_geo_rattrapage();
COMMIT;
