-- STOCKAGE — 3. Combien d'octets chaque jour ajoute, par table, sur les 14 derniers jours (et depuis la 1re capture).
-- Lecture seule. Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-01/stockage/03-croissance.sql'
--
-- Méthode, table par table :
--  * RawBlob/RawBlobBody : EXACT. Un blob est adressé par son empreinte et n'est écrit qu'une fois ; aucun n'a encore été
--    archivé (RawBlobArchive = 0) : les octets gzip des blobs créés un jour = les octets ajoutés au TOAST ce jour-là.
--    Le facteur 1,09 (taille réelle de RawBlobBody / octets gzip déclarés, mesuré en 02-composition) couvre
--    les en-têtes de morceaux TOAST, l'index du TOAST, le tas et la clé primaire.
--  * RawCapture, SourceExtraction : pas d'index sur la date, tas de 785 et 362 Mo -> ÉCHANTILLON de 5 % des blocs, × 20.
--    Coût par ligne = (taille totale de la table, index compris) / lignes : une ligne n'existe pas sans son index.
--  * SourceObservation, Job, JobSource, OccupationObservation, EmployerObservation, PipelineEvent : EXACT, sur les tas
--    (pg_column_size ne décompresse pas le TOAST).
\pset footer off
\timing on

\echo '== Fenêtre : première et dernière création de blob'
SELECT min("createdAt")::timestamp(0) AS premier_blob, max("createdAt")::timestamp(0) AS dernier_blob FROM "RawBlob";

\echo '== RawBlob/RawBlobBody : blobs NOUVEAUX par jour et octets gzip ajoutés (exact)'
SELECT "createdAt"::date AS jour, count(*) AS blobs_nouveaux,
       round(sum("gzipLength") / 1e6) AS gzip_mo,
       round(sum("gzipLength") * 1.09 / 1e6) AS disque_mo_estime,
       round(sum("byteLength") / 1e6) AS decompresse_mo
FROM "RawBlob" GROUP BY 1 ORDER BY 1;

\echo '== Nature des blobs : réponse native, enveloppe de requête, sortie d extraction, manifeste, rapport — 5 % des blocs'
WITH e AS (
  SELECT r.hash, r."gzipLength", r."createdAt",
    CASE
      WHEN EXISTS (SELECT 1 FROM "RawCapture" c WHERE c."blobHash" = r.hash) THEN '1-reponse-native'
      WHEN EXISTS (SELECT 1 FROM "SourceExtraction" x WHERE x."outputHash" = r.hash) THEN '2-sortie-extraction'
      WHEN EXISTS (SELECT 1 FROM "RawCapture" c WHERE c."requestDataHash" = r.hash) THEN '3-enveloppe-requete'
      WHEN EXISTS (SELECT 1 FROM "CaptureOutcome" o WHERE o."manifestHash" = r.hash) THEN '4-manifeste'
      WHEN EXISTS (SELECT 1 FROM "SourceIngestionCompletion" s WHERE s."reportHash" = r.hash) THEN '5-rapport-ingestion'
      WHEN EXISTS (SELECT 1 FROM "SourceObservation" s WHERE s."rawBlobHash" = r.hash) THEN '6-observation-archivee'
      ELSE '9-sans-reference' END AS nature
  FROM "RawBlob" r TABLESAMPLE SYSTEM (5))
SELECT nature, count(*) AS echantillon, round(avg("gzipLength")) AS gzip_moy,
       round(100.0 * sum("gzipLength") / sum(sum("gzipLength")) OVER (), 1) AS pct_octets,
       round(sum("gzipLength") * 20 / 1e9, 2) AS go_extrapoles
FROM e GROUP BY 1 ORDER BY 1;

\echo '== Même partage, par jour (5 % des blocs, Mo extrapolés × 20)'
WITH e AS (
  SELECT r."gzipLength", r."createdAt"::date AS jour,
    CASE
      WHEN EXISTS (SELECT 1 FROM "RawCapture" c WHERE c."blobHash" = r.hash) THEN 'reponse'
      WHEN EXISTS (SELECT 1 FROM "SourceExtraction" x WHERE x."outputHash" = r.hash) THEN 'extraction'
      ELSE 'autre' END AS nature
  FROM "RawBlob" r TABLESAMPLE SYSTEM (5))
SELECT jour,
       round(sum("gzipLength") FILTER (WHERE nature = 'reponse') * 20 / 1e6) AS reponse_mo,
       round(sum("gzipLength") FILTER (WHERE nature = 'extraction') * 20 / 1e6) AS extraction_mo,
       round(sum("gzipLength") FILTER (WHERE nature = 'autre') * 20 / 1e6) AS autre_mo
FROM e GROUP BY 1 ORDER BY 1;

\echo '== RawCapture : captures par jour (5 % des blocs × 20) et Mo (table + index) au coût moyen par ligne'
WITH cout AS (SELECT pg_total_relation_size('"RawCapture"')::numeric / greatest(reltuples, 1) AS o FROM pg_class WHERE relname = 'RawCapture')
SELECT "capturedAt"::date AS jour, count(*) * 20 AS captures_estimees,
       round(count(*) * 20 * (SELECT o FROM cout) / 1e6) AS mo_estimes
FROM "RawCapture" TABLESAMPLE SYSTEM (5) GROUP BY 1 ORDER BY 1;

\echo '== SourceExtraction : sorties par jour (5 % des blocs × 20) et Mo (table + index)'
WITH cout AS (SELECT pg_total_relation_size('"SourceExtraction"')::numeric / greatest(reltuples, 1) AS o FROM pg_class WHERE relname = 'SourceExtraction')
SELECT "capturedAt"::date AS jour, count(*) * 20 AS sorties_estimees,
       round(count(*) * 20 * (SELECT o FROM cout) / 1e6) AS mo_estimes
FROM "SourceExtraction" TABLESAMPLE SYSTEM (5) GROUP BY 1 ORDER BY 1;

\echo '== SourceObservation : observations par jour (exact) et Mo de JSON stocké + coût fixe de ligne et d index'
WITH fixe AS (SELECT (pg_relation_size('"SourceObservation"') + pg_indexes_size('"SourceObservation"'))::numeric
                     / greatest(reltuples, 1) AS o FROM pg_class WHERE relname = 'SourceObservation')
SELECT "observedAt"::date AS jour, count(*) AS observations,
       round(sum(coalesce(pg_column_size(raw), 0)) / 1e6) AS raw_mo,
       round((sum(coalesce(pg_column_size(raw), 0)) + count(*) * (SELECT o FROM fixe)) / 1e6) AS total_mo
FROM "SourceObservation" GROUP BY 1 ORDER BY 1;

\echo '== Job : offres créées par jour (exact) — les mises à jour, elles, ne se datent pas : voir le gonflement en 02'
SELECT "createdAt"::date AS jour, count(*) AS offres_creees FROM "Job"
WHERE "createdAt" > now() - interval '21 days' GROUP BY 1 ORDER BY 1;

\echo '== JobSource : publications vues pour la première fois par jour (exact)'
SELECT "firstSeenAt"::date AS jour, count(*) AS publications FROM "JobSource"
WHERE "firstSeenAt" > now() - interval '21 days' GROUP BY 1 ORDER BY 1;

\echo '== Petites tables d observation et de journal : lignes par jour (exact)'
SELECT 'OccupationObservation' AS t, "createdAt"::date AS jour, count(*) FROM "OccupationObservation"
  WHERE "createdAt" > now() - interval '14 days' GROUP BY 2
UNION ALL SELECT 'EmployerObservation', "observedAt"::date, count(*) FROM "EmployerObservation"
  WHERE "observedAt" > now() - interval '14 days' GROUP BY 2
UNION ALL SELECT 'PipelineEvent', "at"::date, count(*) FROM "PipelineEvent"
  WHERE "at" > now() - interval '14 days' GROUP BY 2
ORDER BY 1, 2;

\echo '== CaptureBatch : tentatives par jour et par finalité (exact)'
SELECT "startedAt"::date AS jour, purpose, count(*) FROM "CaptureBatch"
WHERE "startedAt" > now() - interval '14 days' GROUP BY 1, 2 ORDER BY 1, 2;
