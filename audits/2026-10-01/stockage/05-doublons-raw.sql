-- STOCKAGE — 5. La même sortie d'adaptateur est-elle stockée plusieurs fois ? Comparaison des VALEURS (pas des tailles).
-- Lecture seule, échantillon de ~0,5 % des blocs de JobSource (quelques centaines de lignes, décompressées une à une).
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-01/stockage/05-doublons-raw.sql'
\pset footer off
\timing on
WITH s AS (
  SELECT js.id, js."jobId", js."sourceKey", js."externalId", js.raw AS js_raw, js."captureOutputId"
  FROM "JobSource" js TABLESAMPLE SYSTEM (0.5) WHERE js.raw IS NOT NULL),
c AS (
  SELECT s.*,
    j.raw AS job_raw,
    (j."canonicalSourceKey" = s."sourceKey" AND j."canonicalExternalId" = s."externalId") AS est_canonique,
    (SELECT o.raw FROM "SourceObservation" o
      WHERE o."sourceKey" = s."sourceKey" AND o."externalId" = s."externalId"
      ORDER BY o."observedAt" DESC LIMIT 1) AS obs_raw,
    (SELECT count(*) FROM "SourceObservation" o WHERE o."sourceKey" = s."sourceKey" AND o."externalId" = s."externalId") AS nb_obs
  FROM s LEFT JOIN "Job" j ON j.id = s."jobId")
SELECT count(*) AS publications,
       count(*) FILTER (WHERE est_canonique) AS canoniques,
       count(*) FILTER (WHERE est_canonique AND job_raw = js_raw) AS job_raw_egal_jobsource_raw,
       count(*) FILTER (WHERE obs_raw IS NOT NULL) AS avec_observation,
       count(*) FILTER (WHERE obs_raw = js_raw) AS derniere_observation_egale_jobsource_raw,
       round(avg(nb_obs), 2) AS observations_par_publication,
       max(nb_obs) AS max_observations
FROM c;
