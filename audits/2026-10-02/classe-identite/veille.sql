-- D-520, classe identité d'employeur. LECTURE SEULE de la production, hors fenêtre du RUN (avant 15:30 ou après 18:30 UTC).
-- Le RUN du 23/09 (avant la fenêtre) et l'état des RUN de la fenêtre. Mesuré le 02/10 à 15:02 UTC.
-- Rejeu, depuis le checkout qui porte les accès :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XA -F'|' -v ON_ERROR_STOP=1 -f <worktree>/audits/2026-10-02/classe-identite/veille.sql' > <worktree>/audits/2026-10-02/classe-identite/veille.out
\pset footer off
SET statement_timeout='60s';
SELECT to_char(r."startedAt",'MM-DD HH24:MI') run, e."sourceKey", e.payload#>>'{error,motif}' motif, count(*) FROM "PipelineEvent" e JOIN "PipelineRun" r ON r.id=e."runId"
WHERE r.command='ingest-all' AND r."startedAt">='2026-09-22' AND r."startedAt"<'2026-09-24' AND e.event='job.write_failed' AND e.payload#>>'{error,name}'='EmployerIdentityReviewRequired' GROUP BY 1,2,3 ORDER BY 1,2;
SELECT to_char(r."startedAt",'MM-DD HH24:MI') run, r.status, (SELECT count(*) FROM "PipelineEvent" e WHERE e."runId"=r.id AND e.event='source.issue_classified') issues FROM "PipelineRun" r WHERE r.command='ingest-all' AND r."startedAt">='2026-09-24' ORDER BY 1;
