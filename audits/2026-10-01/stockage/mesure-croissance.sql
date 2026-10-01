-- Croissance par jour des captures brutes et des observations (lecture seule, 01/10/2026).
\pset footer off
SELECT date_trunc('day', c."capturedAt")::date AS jour, count(*) AS captures,
       count(DISTINCT c."blobHash") AS blobs_distincts
FROM "RawCapture" c WHERE c."capturedAt" > now() - interval '21 days' GROUP BY 1 ORDER BY 1;
SELECT min(c."capturedAt")::date AS plus_ancienne, max(c."capturedAt")::date AS plus_recente FROM "RawCapture" c;
SELECT date_trunc('week', o."observedAt")::date AS semaine, count(*) FROM "SourceObservation" o GROUP BY 1 ORDER BY 1 DESC LIMIT 6;
SELECT pg_size_pretty(avg(pg_column_size(b.*))::bigint) AS taille_moyenne_corps FROM (SELECT * FROM "RawBlobBody" TABLESAMPLE SYSTEM (0.2)) b;
