-- D-520, classe identité d'employeur. LECTURE SEULE de la production, hors fenêtre du RUN (avant 15:30 ou après 18:30 UTC).
-- Chaque offre refusée : sa dernière observation attribuée AVANT le RUN, ses témoins (D-506), l'employeur actuel. Mesuré le 02/10 à 14:58 UTC.
-- Rejeu, depuis le checkout qui porte les accès :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XA  -v ON_ERROR_STOP=1 -f <worktree>/audits/2026-10-02/classe-identite/preuves.sql' > <worktree>/audits/2026-10-02/classe-identite/preuves.csv
\pset footer off
\pset format csv
SET statement_timeout='120s';
WITH f AS (
 SELECT DISTINCT r.id run, r."startedAt" t0, e."sourceKey" src, e.payload#>>'{error,externalId}' ext, e.payload#>>'{error,rawEmployerName}' raw, e.payload#>>'{error,motif}' motif, e.payload#>>'{error,proposedName}' proposed
 FROM "PipelineEvent" e JOIN "PipelineRun" r ON r.id=e."runId"
 WHERE r.command='ingest-all' AND r."startedAt">='2026-09-24' AND r."startedAt"<'2026-10-02' AND e.event='job.write_failed'
   AND e.payload#>>'{error,name}'='EmployerIdentityReviewRequired')
SELECT f.run, to_char(f.t0,'YYYY-MM-DD HH24:MI') jour, f.src, f.ext, f.motif, f.raw, f.proposed,
  p."labelOrigin" prev_origin, p."normalizedEmployerName" prev_label, p.rule prev_rule, pc.name prev_company, to_char(p."observedAt",'MM-DD HH24:MI') prev_at,
  (SELECT count(DISTINCT w."externalId") FROM "EmployerObservation" w WHERE w."sourceKey"=f.src AND w."normalizedEmployerName"=lower(f.raw) AND w."canonicalEmployerId" IS NOT NULL AND w."observedAt"<f.t0 AND w."externalId"<>f.ext) temoins_avant,
  jc.name job_company, j.title, j.url
FROM f
LEFT JOIN LATERAL (SELECT * FROM "EmployerObservation" o WHERE o."sourceKey"=f.src AND o."externalId"=f.ext AND o."canonicalEmployerId" IS NOT NULL AND o."observedAt"<f.t0 ORDER BY o."observedAt" DESC, o.id DESC LIMIT 1) p ON true
LEFT JOIN "Company" pc ON pc.id=p."canonicalEmployerId"
LEFT JOIN "JobSource" js ON js."sourceKey"=f.src AND js."externalId"=f.ext
LEFT JOIN "Job" j ON j.id=js."jobId" LEFT JOIN "Company" jc ON jc.id=j."companyId"
ORDER BY 2,3,4;
