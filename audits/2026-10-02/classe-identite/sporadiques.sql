-- D-520, classe identité d'employeur. LECTURE SEULE de la production, hors fenêtre du RUN (avant 15:30 ou après 18:30 UTC).
-- Les refus d'une ou deux offres (sources à libellé natif) : historique de chaque offre et employeurs natifs du même RUN. Mesuré le 02/10 à 14:56 UTC.
-- Rejeu, depuis le checkout qui porte les accès :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XA -F'|' -v ON_ERROR_STOP=1 -f <worktree>/audits/2026-10-02/classe-identite/sporadiques.sql' > <worktree>/audits/2026-10-02/classe-identite/sporadiques.out
\pset footer off
SET statement_timeout='120s';
WITH f AS (
 SELECT r.id run, r."startedAt" t0, coalesce(r."finishedAt", r."startedAt"+interval '4 hours') t1, e."sourceKey" src, e.payload#>>'{error,externalId}' ext, e.payload#>>'{error,rawEmployerName}' raw, e.payload#>>'{error,motif}' motif
 FROM "PipelineEvent" e JOIN "PipelineRun" r ON r.id=e."runId"
 WHERE r.command='ingest-all' AND r."startedAt">='2026-09-24' AND r."startedAt"<'2026-10-02' AND e.event='job.write_failed'
   AND e.payload#>>'{error,name}'='EmployerIdentityReviewRequired'
   AND e."sourceKey" IN ('aptar-beauty','avolta','crocs','drunk-elephant-2','escada-parfums-16','monoprix','prada-group','sephora-france','puma','richemont','richemont-workday','swatch-group','tapestry'))
SELECT f.src, to_char(f.t0,'MM-DD') run, f.ext, f.motif, f.raw,
  (SELECT string_agg(DISTINCT o."normalizedEmployerName"||'>'||coalesce(c.name,'∅')||'/'||o.rule, '; ') FROM "EmployerObservation" o LEFT JOIN "Company" c ON c.id=o."canonicalEmployerId" WHERE o."sourceKey"=f.src AND o."externalId"=f.ext) hist_posting,
  (SELECT count(DISTINCT o."canonicalEmployerId")||' emp / '||count(DISTINCT o."externalId")||' offres : '||left(string_agg(DISTINCT coalesce(c.name,'∅'), ', '),200) FROM "EmployerObservation" o LEFT JOIN "Company" c ON c.id=o."canonicalEmployerId" WHERE o."sourceKey"=f.src AND o."observedAt" BETWEEN f.t0 AND f.t1 AND o."labelOrigin" NOT IN ('SOURCE_CATALOGUE_LABEL') ) natifs_du_run,
  (SELECT coalesce(c.name,'∅') FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" JOIN "Company" c ON c.id=j."companyId" WHERE js."sourceKey"=f.src AND js."externalId"=f.ext) actuel
FROM f ORDER BY 1,2;
