-- D-520, classe identité d'employeur. LECTURE SEULE de la production, hors fenêtre du RUN (avant 15:30 ou après 18:30 UTC).
-- Offres publiées (SourceRun.jobs) par RUN pour les 27 sources : l'échéance 48 h / 7 jours de la file. Mesuré le 02/10 à 15:13 UTC.
-- Rejeu, depuis le checkout qui porte les accès :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XA  -v ON_ERROR_STOP=1 -f <worktree>/audits/2026-10-02/classe-identite/sourcerun.sql' > <worktree>/audits/2026-10-02/classe-identite/sourcerun.csv (puis gzip)
\pset footer off
\pset format csv
SET statement_timeout='60s';
SELECT to_char(r."startedAt",'YYYY-MM-DD HH24:MI') jour, sr."sourceKey" src, sr.status, sr.jobs, to_char(sr."ranAt",'MM-DD HH24:MI') ran
FROM "PipelineRun" r JOIN "SourceRun" sr ON sr."ranAt" BETWEEN r."startedAt" AND coalesce(r."finishedAt", r."startedAt"+interval '4 hours')
WHERE r.command='ingest-all' AND r."startedAt">='2026-09-24' AND r."startedAt"<'2026-10-02'
  AND sr."sourceKey" IN ('aptar-beauty','avolta','beauty-success-geodir','brown-thomas-taleo','browns','crocs','drunk-elephant-2','escada-parfums-16','groupe-printemps','hot-topic','lagardere-duty-free','lagardere-travel-retail','lagardere-travel-retail-de','luxe-talent','lvmh','monoprix','prada-group','rivoli-typesense','sephora-france','tiffany-oracle','b-s-international','funky-buddha','puma','richemont','richemont-workday','swatch-group','tapestry')
ORDER BY 1,2;
