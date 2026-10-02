-- D-520, classe identité d'employeur. LECTURE SEULE de la production, hors fenêtre du RUN (avant 15:30 ou après 18:30 UTC).
-- Chaque refus d'identité (job.write_failed) des 8 RUN ingest-all du 24/09 au 01/10, par RUN, source, motif et libellé. Mesuré le 02/10 à 14:54 UTC.
-- Rejeu, depuis le checkout qui porte les accès :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XA  -v ON_ERROR_STOP=1 -f <worktree>/audits/2026-10-02/classe-identite/echecs.sql' > <worktree>/audits/2026-10-02/classe-identite/echecs.csv (puis gzip)
\pset footer off
\pset format csv
SET statement_timeout='120s';
SELECT r.id run, to_char(r."startedAt",'YYYY-MM-DD HH24:MI') jour, e."sourceKey" src, e.payload#>>'{error,motif}' motif,
  e.payload#>>'{error,rawEmployerName}' raw, e.payload#>>'{error,proposedName}' proposed, count(*) n,
  min(e.payload#>>'{error,externalId}') ex1, max(e.payload#>>'{error,externalId}') ex2
FROM "PipelineEvent" e JOIN "PipelineRun" r ON r.id=e."runId"
WHERE r.command='ingest-all' AND r."startedAt">='2026-09-24' AND r."startedAt"<'2026-10-02' AND e.event='job.write_failed'
  AND e.payload#>>'{error,name}'='EmployerIdentityReviewRequired'
GROUP BY 1,2,3,4,5,6 ORDER BY 2,3,4,5;
