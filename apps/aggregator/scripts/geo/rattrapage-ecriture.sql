-- D-496 — LE RATTRAPAGE DU POINT DES OFFRES, ÉCRITURE. Sur GO, hors RUN, après le chargement de la base de villes
-- (villes.py charger --ecrire) et le passage à blanc (rattrapage-a-blanc.sql). Rejouable : un second passage n'écrit
-- rien. Seules les colonnes `geo*` sont écrites : aucun déclencheur ne se déclenche, aucune donnée native n'est touchée.
--
-- EN TRANCHES (coordinateur, 01/10/2026) : la synchronisation directe tourne toutes les 5 minutes et ne doit jamais
-- attendre plus de quelques secondes. L'apprentissage s'écrit dans une transaction courte (table `GeoCityLearned`
-- seule) ; le point des offres par `catwalks_geo_rattrapage_ecrire`, une validation toutes les 1 000 offres, verrous de
-- ligne rendus à chaque tranche. `lock_timeout` 2 s : si une ligne est tenue par une autre écriture, le script s'arrête
-- au lieu d'attendre ; les tranches déjà validées restent, et on le relance.
--
--   python3 apps/aggregator/scripts/ops/db.py production sh -c \
--     'psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f apps/aggregator/scripts/geo/rattrapage-ecriture.sql'
\pset footer off
SET lock_timeout = '2s';
SET statement_timeout = '15min';

-- 1. Ce que le catalogue a appris des noms ambigus (« Beverly Hills » sans État) : la table est remplacée par
--    l'apprentissage du jour ; le déclencheur s'en sert pour les offres suivantes, la recherche pour les saisies.
BEGIN;
CREATE TEMP TABLE geo_appris ON COMMIT DROP AS SELECT * FROM catwalks_geo_apprentissage();
\echo 'Noms appris'
SELECT count(*) AS noms_appris, coalesce(sum(offers), 0) AS offres_natives FROM geo_appris;
DELETE FROM "GeoCityLearned" l
 WHERE NOT EXISTS (SELECT 1 FROM geo_appris a WHERE a."countryCode" = l."countryCode" AND a."nameKey" = l."nameKey");
INSERT INTO "GeoCityLearned" ("countryCode", "nameKey", "cityId", "offers")
SELECT "countryCode", "nameKey", "cityId", offers FROM geo_appris
ON CONFLICT ("countryCode", "nameKey") DO UPDATE SET "cityId" = EXCLUDED."cityId", "offers" = EXCLUDED."offers", "learnedAt" = CURRENT_TIMESTAMP
 WHERE ("GeoCityLearned"."cityId", "GeoCityLearned"."offers") IS DISTINCT FROM (EXCLUDED."cityId", EXCLUDED."offers");
COMMIT;

-- 2. Le point des offres, en tranches de 1 000 (le nombre écrit s'affiche en NOTICE).
CALL catwalks_geo_rattrapage_ecrire(1000);

\echo 'Reste à rattraper après écriture (attendu : 0, sauf écriture concurrente)'
SELECT count(*) AS reste FROM catwalks_geo_rattrapage();
