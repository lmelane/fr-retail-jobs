-- STOCKAGE — 11. Les purges et rétentions existantes tournent-elles ? Preuve par les dates extrêmes. Lecture seule.
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-01/stockage/11-purges-existantes.sql'
-- Attendu si une purge fonctionne : la ligne la plus ancienne reste dans sa fenêtre.
\pset footer off
\echo '== SourceRun : élagué à 10 jours à chaque RUN (apps/aggregator/src/pipeline/health.ts, HISTORY = 10)'
SELECT min("ranAt")::timestamp(0) AS plus_ancienne, max("ranAt")::timestamp(0) AS plus_recente, count(*) FROM "SourceRun";
\echo '== Archive des corps bruts (src/retention, script manuel scripts/ops/retention.mts) : pointeurs écrits'
SELECT count(*) AS archives, min("verifiedAt") AS premiere FROM "RawBlobArchive";
\echo '== Tables sans aucune purge : plus ancienne ligne'
SELECT 'PipelineEvent' AS t, min(at)::timestamp(0) AS plus_ancienne, count(*) FROM "PipelineEvent"
UNION ALL SELECT 'SourceObservation', min("observedAt")::timestamp(0), count(*) FROM "SourceObservation"
UNION ALL SELECT 'EmployerObservation', min("observedAt")::timestamp(0), count(*) FROM "EmployerObservation"
UNION ALL SELECT 'OccupationObservation', min("createdAt")::timestamp(0), count(*) FROM "OccupationObservation";
\echo '== File de recherche par génération (la génération non servie n est vidée par personne)'
SELECT version, count(*) AS en_attente FROM "SearchPending" GROUP BY 1 ORDER BY 1;
