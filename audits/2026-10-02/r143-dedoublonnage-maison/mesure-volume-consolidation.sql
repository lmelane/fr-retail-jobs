-- R-143 §4 — M3 : ce que `consolidate-publications` trouverait AUJOURD'HUI, avec les clés déjà posées en production
-- (avant tout déploiement de ce lot) : même requête que `splitIdentityGroups` (dedup/consolidate.ts), sans la borne.
-- Lecture seule. Rejouer : python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -f -' < mesure-volume-consolidation.sql
SET statement_timeout = '180s';
WITH g AS (SELECT "companyId", "clusterKey", count(*) n FROM "Job"
  WHERE "isActive" AND "mergedIntoId" IS NULL AND "clusterKey" IS NOT NULL
    AND ("clusterKey" LIKE '["requisition",%' OR "clusterKey" LIKE '["feed-publication",%' OR "clusterKey" LIKE '["application",%')
  GROUP BY 1, 2 HAVING count(*) >= 2)
SELECT (("clusterKey")::jsonb)->>0 AS genre, (("clusterKey")::jsonb)->>1 AS lecteur,
  count(*) FILTER (WHERE n <= 25) AS groupes_retenus, count(*) FILTER (WHERE n > 25) AS groupes_hors_borne_25,
  sum(n) FILTER (WHERE n <= 25) AS offres, sum(n - 1) FILTER (WHERE n <= 25) AS offres_absorbees_si_prouvees
FROM g GROUP BY 1, 2 ORDER BY 3 DESC;
