-- STOCKAGE — 7. Ce qu'une rétention garderait chaud : âge de la DERNIÈRE référence de chaque blob, et ensemble minimal.
-- Lecture seule. Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-01/stockage/07-retention-scenarios.sql'
--
-- Un blob est dédupliqué par empreinte : un blob CRÉÉ il y a 10 jours peut être encore cité par la capture d'aujourd'hui.
-- Ce qui compte pour une rétention est donc la date de sa dernière référence (capture, sortie, manifeste, rapport),
-- exactement le critère de src/retention/retention.ts (aucune référence plus récente que le seuil).
\pset footer off
\timing on

\echo '== A. Octets gzip par âge de la dernière référence (5 % des blocs de RawBlob, × 20)'
WITH e AS (
  SELECT r."gzipLength", greatest(
      (SELECT max(c."capturedAt") FROM "RawCapture" c WHERE c."blobHash" = r.hash),
      (SELECT max(c."capturedAt") FROM "RawCapture" c WHERE c."requestDataHash" = r.hash),
      (SELECT max(x."capturedAt") FROM "SourceExtraction" x WHERE x."outputHash" = r.hash),
      (SELECT max(o."completedAt") FROM "CaptureOutcome" o WHERE o."manifestHash" = r.hash),
      (SELECT max(s."completedAt") FROM "SourceIngestionCompletion" s WHERE s."reportHash" = r.hash)) AS derniere_ref
  FROM "RawBlob" r TABLESAMPLE SYSTEM (5))
SELECT CASE WHEN derniere_ref IS NULL THEN '9-jamais referencé'
            WHEN derniere_ref > now() - interval '1 day' THEN '0-moins de 1 j'
            WHEN derniere_ref > now() - interval '3 days' THEN '1-1 à 3 j'
            WHEN derniere_ref > now() - interval '7 days' THEN '2-3 à 7 j'
            WHEN derniere_ref > now() - interval '14 days' THEN '3-7 à 14 j'
            ELSE '4-plus de 14 j' END AS age_derniere_reference,
       count(*) * 20 AS blobs_estimes, round(sum("gzipLength") * 20 / 1e9, 2) AS go_gzip_estimes
FROM e GROUP BY 1 ORDER BY 1;

\echo '== B. Ensemble chaud MINIMAL : blobs cités par les tentatives qui décident encore quelque chose (exact)'
\echo '   = dernière tentative par (source, finalité) + dernière tentative JOBS achevée par source'
\echo '   + tentative de la dernière validation de chaque révision + tentative citée par une publication active'
WITH lots AS (
  SELECT id FROM (SELECT DISTINCT ON ("sourceKey", purpose) id FROM "CaptureBatch" ORDER BY "sourceKey", purpose, "startedAt" DESC) a
  UNION SELECT id FROM (SELECT DISTINCT ON (b."sourceKey") b.id FROM "CaptureBatch" b
                        JOIN "SourceIngestionCompletion" s ON s."batchId" = b.id ORDER BY b."sourceKey", b."startedAt" DESC) b
  UNION SELECT "captureBatchId" FROM (SELECT DISTINCT ON ("sourceRevisionId") "captureBatchId" FROM "SourceValidation"
                        ORDER BY "sourceRevisionId", sequence DESC) v
  UNION SELECT DISTINCT "captureBatchId" FROM "JobSource" WHERE "isActive" AND "captureBatchId" IS NOT NULL),
h AS (
  SELECT c."blobHash" AS hash FROM "RawCapture" c JOIN lots ON lots.id = c."batchId" WHERE c."blobHash" IS NOT NULL
  UNION SELECT c."requestDataHash" FROM "RawCapture" c JOIN lots ON lots.id = c."batchId" WHERE c."requestDataHash" IS NOT NULL
  UNION SELECT x."outputHash" FROM "SourceExtraction" x JOIN lots ON lots.id = x."batchId"
  UNION SELECT o."manifestHash" FROM "CaptureOutcome" o JOIN lots ON lots.id = o."batchId" WHERE o."manifestHash" IS NOT NULL
  UNION SELECT s."reportHash" FROM "SourceIngestionCompletion" s JOIN lots ON lots.id = s."batchId")
SELECT (SELECT count(*) FROM lots) AS tentatives_retenues,
       count(*) AS blobs, round(sum(r."gzipLength") / 1e9, 2) AS go_gzip,
       round(100.0 * sum(r."gzipLength") / (SELECT sum("gzipLength") FROM "RawBlob"), 1) AS pct_du_total
FROM h JOIN "RawBlob" r ON r.hash = h.hash;

\echo '== C. Pour comparaison : les tentatives des 3 et 7 derniers jours (exact sur CaptureBatch, blobs dédupliqués)'
WITH lots AS (SELECT id, "startedAt" FROM "CaptureBatch" WHERE "startedAt" > now() - interval '7 days'),
h AS (
  SELECT c."blobHash" AS hash, max(l."startedAt") AS t FROM "RawCapture" c JOIN lots l ON l.id = c."batchId" WHERE c."blobHash" IS NOT NULL GROUP BY 1
  UNION ALL SELECT x."outputHash", max(l."startedAt") FROM "SourceExtraction" x JOIN lots l ON l.id = x."batchId" GROUP BY 1),
d AS (SELECT hash, max(t) AS t FROM h GROUP BY 1)
SELECT round(sum(r."gzipLength") FILTER (WHERE d.t > now() - interval '3 days') / 1e9, 2) AS go_gzip_3_jours,
       round(sum(r."gzipLength") / 1e9, 2) AS go_gzip_7_jours
FROM d JOIN "RawBlob" r ON r.hash = d.hash;
