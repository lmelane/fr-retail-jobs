-- D-517 — données de la projection (lues par projection.py ; même requête que cadence-r143/projection-donnees.sql, sorties ici). Production, LECTURE SEULE, hors RUN.
-- Rejouer depuis le checkout de référence (deux sorties CSV, dans ce dossier) :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F "," -f audits/2026-10-02/fraicheur-d517/projection-donnees.sql'
-- Même population que M3/M4 de mesure-sources.sql : nouvelles offres vues depuis le 25/09, source canonique présente
-- avant le 24/09, non fusionnées, pays connu.

\pset footer off
\o audits/2026-10-02/fraicheur-d517/offres.csv
WITH anciennete AS (SELECT "sourceKey", min("firstSeenAt") premiere FROM "JobSource" GROUP BY 1)
SELECT j."canonicalSourceKey" sk, to_char(j."postedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') posted,
  to_char(j."firstSeenAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') first_seen,
  (j."postedAt" = date_trunc('day', j."postedAt"))::int jour_seul
FROM "Job" j JOIN anciennete a ON a."sourceKey"=j."canonicalSourceKey"
WHERE a.premiere < '2026-09-24' AND j."firstSeenAt" >= '2026-09-25' AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL
ORDER BY 1, 3;

-- Les collectes d'offres achevées (résultat scellé EXTRACTED) de chaque source depuis le 20/09 : la dernière avant la
-- première observation d'une offre borne l'instant où elle est apparue à la source.
\o audits/2026-10-02/fraicheur-d517/collectes.csv
SELECT cb."sourceKey" sk, to_char(cb."startedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') started
FROM "CaptureBatch" cb JOIN "CaptureOutcome" o ON o."batchId"=cb.id
WHERE cb.purpose='JOBS' AND o.status='EXTRACTED' AND cb."startedAt" >= '2026-09-20'
ORDER BY 1, 2;
\o
