-- D-518 — la même reconstruction que `../boucle-couverture/historique.sql`, avec la SOURCE canonique de chaque offre :
-- pour juger aussi la perte d'une source au regard de son habitude. LECTURE SEULE, hors fenêtre du RUN (15:30-18:30 UTC).
--   python3 <checkout qui porte les accès>/apps/aggregator/scripts/ops/db.py readonly sh -c \
--     'psql "$DATABASE_URL" -X -A -t -q -v ON_ERROR_STOP=1 -f "$OLDPWD/audits/2026-10-02/alerte-anomalie-d518/historique-sources.sql"' \
--     | gzip -9 > audits/2026-10-02/alerte-anomalie-d518/historique-sources.json.gz
-- Mêmes RUN (ingest-all achevés depuis le 23/09, et l'instant de la mesure) ; source = `canonicalSourceKey` actuelle.
SET statement_timeout = '240s';
SET default_transaction_read_only = on;

WITH runs AS (
  SELECT id, "finishedAt" AS t FROM "PipelineRun"
  WHERE command = 'ingest-all' AND "finishedAt" IS NOT NULL AND "startedAt" >= '2026-09-23'
  UNION ALL SELECT 'maintenant', now() AT TIME ZONE 'UTC'),
etat AS (
  SELECT r.id AS run, j."companyId", j."countryCode", j."canonicalSourceKey",
    (SELECT e.type FROM "JobEvent" e WHERE e."jobId" = j.id AND e.type IN ('CLOSED','WITHDRAWN','REOPENED','REPUBLISHED')
       AND e.at <= r.t ORDER BY e.at DESC LIMIT 1) AS dernier
  FROM runs r JOIN "Job" j ON j."firstSeenAt" <= r.t AND j."countryCode" IS NOT NULL AND j."mergedIntoId" IS NULL)
SELECT json_build_object('bloc', 'servies', 'lignes', coalesce(json_agg(x), '[]'::json)) FROM (
  SELECT run, "companyId" AS c, "countryCode" AS p, "canonicalSourceKey" AS s, count(*)::int AS n FROM etat
  WHERE dernier IS NULL OR dernier IN ('REOPENED','REPUBLISHED') GROUP BY 1, 2, 3, 4) x;

SELECT json_build_object('bloc', 'sorties', 'lignes', coalesce(json_agg(x), '[]'::json)) FROM (
  SELECT e.type, e.after AS motif, j."companyId" AS c, j."countryCode" AS p, j."canonicalSourceKey" AS s, e.at
  FROM "JobEvent" e JOIN "Job" j ON j.id = e."jobId"
  WHERE e.type IN ('CLOSED','WITHDRAWN') AND e.at >= '2026-09-16' AND j."countryCode" IS NOT NULL AND j."mergedIntoId" IS NULL) x;
