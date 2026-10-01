-- STOCKAGE — 6. Pourquoi une même publication produit ~4 observations en 13 jours : quelles clés changent ?
-- Lecture seule. Échantillon : ~0,3 % des blocs de SourceObservation, deux versions successives d'une même publication.
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-01/stockage/06-volatilite-observations.sql'
\pset footer off
\timing on
WITH s AS (
  SELECT o.id, o."sourceKey", o."externalId", o."observedAt", o.raw
  FROM "SourceObservation" o TABLESAMPLE SYSTEM (0.3)),
paire AS (
  SELECT s."sourceKey", s.raw AS apres,
    (SELECT p.raw FROM "SourceObservation" p
      WHERE p."sourceKey" = s."sourceKey" AND p."externalId" = s."externalId" AND p."observedAt" < s."observedAt"
      ORDER BY p."observedAt" DESC LIMIT 1) AS avant
  FROM s),
diff AS (
  SELECT paire."sourceKey", k.key
  FROM paire, LATERAL (
    SELECT key FROM jsonb_object_keys(coalesce(paire.apres, '{}'::jsonb) || coalesce(paire.avant, '{}'::jsonb)) AS key
    WHERE jsonb_typeof(paire.apres) = 'object' AND jsonb_typeof(paire.avant) = 'object'
      AND (paire.apres -> key) IS DISTINCT FROM (paire.avant -> key)) k
  WHERE paire.avant IS NOT NULL)
SELECT key AS cle_qui_change, count(*) AS paires, count(DISTINCT "sourceKey") AS sources
FROM diff GROUP BY 1 ORDER BY 2 DESC LIMIT 25;

WITH s AS (SELECT o."sourceKey", o."externalId", o."observedAt" FROM "SourceObservation" o TABLESAMPLE SYSTEM (0.3))
SELECT count(*) AS echantillon,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "SourceObservation" p WHERE p."sourceKey" = s."sourceKey"
         AND p."externalId" = s."externalId" AND p."observedAt" < s."observedAt")) AS avec_version_precedente
FROM s;
