-- STOCKAGE — 8. Décomposition de l'ensemble chaud minimal (07-B) : quelle famille de tentatives pèse quoi.
-- Lecture seule. Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-01/stockage/08-ensemble-minimal-detail.sql'
\pset footer off
\timing on
WITH lots AS (
  SELECT 'a-derniere par source et finalite: '||purpose AS famille, id FROM
    (SELECT DISTINCT ON ("sourceKey", purpose) id, purpose::text FROM "CaptureBatch" ORDER BY "sourceKey", purpose, "startedAt" DESC) a
  UNION ALL SELECT 'b-derniere JOBS achevee', id FROM (SELECT DISTINCT ON (b."sourceKey") b.id FROM "CaptureBatch" b
                        JOIN "SourceIngestionCompletion" s ON s."batchId" = b.id ORDER BY b."sourceKey", b."startedAt" DESC) b
  UNION ALL SELECT 'c-derniere validation par revision', "captureBatchId" FROM (SELECT DISTINCT ON ("sourceRevisionId") "captureBatchId"
                        FROM "SourceValidation" ORDER BY "sourceRevisionId", sequence DESC) v
  UNION ALL SELECT 'd-citee par publication active', id FROM (SELECT DISTINCT "captureBatchId" AS id FROM "JobSource"
                        WHERE "isActive" AND "captureBatchId" IS NOT NULL) j),
h AS (
  SELECT l.famille, c."blobHash" AS hash FROM "RawCapture" c JOIN lots l ON l.id = c."batchId" WHERE c."blobHash" IS NOT NULL
  UNION SELECT l.famille, x."outputHash" FROM "SourceExtraction" x JOIN lots l ON l.id = x."batchId")
SELECT h.famille, (SELECT count(DISTINCT id) FROM lots WHERE lots.famille = h.famille) AS tentatives,
       (SELECT min(b."startedAt")::date FROM "CaptureBatch" b JOIN lots ON lots.id = b.id WHERE lots.famille = h.famille) AS plus_ancienne,
       count(*) AS blobs, round(sum(r."gzipLength") / 1e9, 2) AS go_gzip
FROM h JOIN "RawBlob" r ON r.hash = h.hash GROUP BY 1 ORDER BY 1;
