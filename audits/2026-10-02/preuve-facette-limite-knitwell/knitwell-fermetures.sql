-- D-520 §4 a : ce que les fausses preuves de knitwell-us-retail (complete et canAttestAbsence vrais avec 2 000 offres lues
-- sur 3 515) ont fermé, par jour. LECTURE SEULE, hors fenêtre du RUN. Rejouable :
--   CATWALKS_DB_ACCESS=<checkout>/backups/remediation-20260908 python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
--     'psql "$DATABASE_URL" -XA -v ON_ERROR_STOP=1 -f audits/2026-10-02/preuve-facette-limite-knitwell/knitwell-fermetures.sql' \
--     > audits/2026-10-02/preuve-facette-limite-knitwell/knitwell-fermetures.out
-- Schéma de production du 02/10 : ni `publisherClosedAt` ni retenue de disponibilité (migration R-143
-- `20261002140000` non livrée) ; une désactivation sur preuve se lit, comme le rattrapage de cette migration, dans
-- `DataCorrection` REFRESH_LIFECYCLE APPLIED (`evidence.deactivatedIds`). Aucune retenue n'a donc pu être posée.
-- « À tort » se lit contre la liste complète : `reouverture-fausse-preuve.mts` (aperçu) fait le partage.
\pset footer off
SET statement_timeout = '120s';
SET default_transaction_read_only = on;
-- 1. représentations de knitwell désactivées sur preuve depuis le 23/09, par jour, et leur état aujourd'hui
WITH deact AS (
  SELECT DISTINCT ON (d.id) d.id, dc."createdAt" AS at
  FROM "DataCorrection" dc
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(dc.evidence->'deactivatedIds') = 'array'
    THEN dc.evidence->'deactivatedIds' ELSE '[]'::jsonb END) AS d(id)
  WHERE dc.finding = 'REFRESH_LIFECYCLE' AND dc.evidence->>'outcome' = 'APPLIED' AND dc."createdAt" >= '2026-09-23'
  ORDER BY d.id, dc."createdAt" DESC)
SELECT date_trunc('day', x.at) deactivated_day, s."isActive" now_active, (s."lastSeenAt" >= x.at) seen_again, j."isActive" job_active, count(*)
FROM deact x JOIN "JobSource" s ON s.id = x.id LEFT JOIN "Job" j ON j.id = s."jobId"
WHERE s."sourceKey" = 'knitwell-us-retail' GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4;
-- 2. événements de cycle de vie des offres de la source depuis le 23/09
SELECT date_trunc('day', e.at) event_day, e.type, count(DISTINCT e."jobId")
FROM "JobEvent" e WHERE e.at >= '2026-09-23' AND e.type IN ('CLOSED', 'WITHDRAWN', 'REOPENED', 'REPUBLISHED')
  AND EXISTS (SELECT 1 FROM "JobSource" s WHERE s."jobId" = e."jobId" AND s."sourceKey" = 'knitwell-us-retail')
GROUP BY 1, 2 ORDER BY 1, 2;
-- 3. représentations de la source aujourd'hui
WITH deact AS (
  SELECT DISTINCT ON (d.id) d.id, dc."createdAt" AS at
  FROM "DataCorrection" dc
  CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(dc.evidence->'deactivatedIds') = 'array'
    THEN dc.evidence->'deactivatedIds' ELSE '[]'::jsonb END) AS d(id)
  WHERE dc.finding = 'REFRESH_LIFECYCLE' AND dc.evidence->>'outcome' = 'APPLIED' AND dc."createdAt" >= '2026-09-23'
  ORDER BY d.id, dc."createdAt" DESC)
SELECT CASE WHEN s."isActive" AND j."isActive" THEN 'servie'
            WHEN NOT s."isActive" AND x.id IS NOT NULL THEN 'désactivée sur preuve depuis le 23/09'
            WHEN NOT s."isActive" THEN 'inactive, autre cause ou avant le 23/09'
            ELSE 'représentation active, offre inactive' END etat, count(*)
FROM "JobSource" s LEFT JOIN "Job" j ON j.id = s."jobId" LEFT JOIN deact x ON x.id = s.id
WHERE s."sourceKey" = 'knitwell-us-retail' GROUP BY 1 ORDER BY 1;
