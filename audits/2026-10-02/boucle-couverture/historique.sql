-- R-143 §11, D-515 §5, D-516 §2 — rejeu de l'alerte de couverture sur l'historique réel, en LECTURE SEULE.
-- Rejouer (checkout qui porte les accès, jamais entre 15:30 et 18:30 UTC) :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
--     'psql "$DATABASE_URL" -X -A -t -q -v ON_ERROR_STOP=1 -f audits/2026-10-02/boucle-couverture/historique.sql' \
--     | gzip -9 > audits/2026-10-02/boucle-couverture/historique.json.gz
-- puis : npx tsx audits/2026-10-02/boucle-couverture/rejeu.mts audits/2026-10-02/boucle-couverture/historique.json.gz audits/2026-10-02/boucle-couverture/a-blanc.json.gz audits/2026-10-02/d508-swatch-fermeture/fermetures-a-blanc.csv
--
-- Une ligne JSON par bloc. RECONSTRUCTION (aucune photographie n'existait avant ce lot) :
--   · servie à l'instant t (fin d'un RUN) = offre vue au plus tard à t, non fusionnée, pays connu, dont le dernier
--     événement de cycle de vie à t (JobEvent CLOSED, WITHDRAWN, REOPENED, REPUBLISHED) n'est pas une fin. Aucune
--     offre inactive n'est sans événement de fin (mesuré le 02/10 : 0) ; les retenues de disponibilité n'existaient
--     pas en production : l'historique ne contient aucun masquage, il est simulé à part (bloc « a_blanc ») ;
--   · Maison = société actuelle de l'offre (les sociétés fusionnées sont suivies par le rejeu) ; pays = pays actuel ;
--   · menace = offre servie à t dont TOUTES les représentations (vues au plus tard à t) viennent de sources actives dont
--     la collecte de ce RUN a échoué (SourceRun ERROR, BROKEN, TIMEOUT) : elle serait masquée 72 h après sa dernière
--     observation si la collecte ne reprenait pas.
SET statement_timeout = '180s';
SET default_transaction_read_only = on;

-- runs : les RUN quotidiens achevés depuis le rechargement du catalogue (23/09), et l'instant de la mesure.
SELECT json_build_object('bloc', 'runs', 'lignes', coalesce(json_agg(r ORDER BY r.t), '[]'::json)) FROM (
  SELECT id, "startedAt" AS debut, "finishedAt" AS t, status FROM "PipelineRun"
  WHERE command = 'ingest-all' AND "finishedAt" IS NOT NULL AND "startedAt" >= '2026-09-23'
  UNION ALL SELECT 'maintenant', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC', 'MESURE') r;

-- servies : offres servies par (instant, société, pays).
WITH runs AS (
  SELECT id, "finishedAt" AS t FROM "PipelineRun"
  WHERE command = 'ingest-all' AND "finishedAt" IS NOT NULL AND "startedAt" >= '2026-09-23'
  UNION ALL SELECT 'maintenant', now() AT TIME ZONE 'UTC'),
etat AS (
  SELECT r.id AS run, j."companyId", j."countryCode",
    (SELECT e.type FROM "JobEvent" e WHERE e."jobId" = j.id AND e.type IN ('CLOSED','WITHDRAWN','REOPENED','REPUBLISHED')
       AND e.at <= r.t ORDER BY e.at DESC LIMIT 1) AS dernier
  FROM runs r JOIN "Job" j ON j."firstSeenAt" <= r.t AND j."countryCode" IS NOT NULL AND j."mergedIntoId" IS NULL)
SELECT json_build_object('bloc', 'servies', 'lignes', coalesce(json_agg(x), '[]'::json)) FROM (
  SELECT run, "companyId" AS c, "countryCode" AS p, count(*)::int AS n FROM etat
  WHERE dernier IS NULL OR dernier IN ('REOPENED','REPUBLISHED') GROUP BY 1, 2, 3) x;

-- sorties : chaque fin d'offre (fermeture prouvée, retrait) depuis le 16/09, avec sa société, son pays, son motif.
SELECT json_build_object('bloc', 'sorties', 'lignes', coalesce(json_agg(x), '[]'::json)) FROM (
  SELECT e.type, e.after AS motif, j."companyId" AS c, j."countryCode" AS p, e.at
  FROM "JobEvent" e JOIN "Job" j ON j.id = e."jobId"
  WHERE e.type IN ('CLOSED','WITHDRAWN') AND e.at >= '2026-09-16' AND j."countryCode" IS NOT NULL AND j."mergedIntoId" IS NULL) x;

-- menaces : offres servies à t qui ne tiennent qu'à des sources actives en échec à ce RUN.
WITH runs AS (
  SELECT id, "finishedAt" AS t FROM "PipelineRun"
  WHERE command = 'ingest-all' AND "finishedAt" IS NOT NULL AND "startedAt" >= '2026-09-23'),
ko AS (
  SELECT DISTINCT ON ("runId", "sourceKey") "runId", "sourceKey", status, left(coalesce(note, ''), 160) AS note
  FROM "SourceRun" WHERE "runId" IN (SELECT id FROM runs) ORDER BY "runId", "sourceKey", "ranAt" DESC),
enechec AS (
  SELECT k.* FROM ko k JOIN "Source" s ON s.key = k."sourceKey" AND s.status = 'ACTIVE'
  WHERE k.status IN ('ERROR','BROKEN','TIMEOUT')),
offre AS (
  SELECT DISTINCT ON (r.id, j.id) r.id AS run, r.t, j.id, j."companyId", j."countryCode", k."sourceKey" AS source, k.status, k.note,
    js."lastSeenAt" AS vu
  FROM enechec k JOIN runs r ON r.id = k."runId"
  JOIN "JobSource" js ON js."sourceKey" = k."sourceKey" AND js."firstSeenAt" <= r.t
  JOIN "Job" j ON j.id = js."jobId" AND j."firstSeenAt" <= r.t AND j."countryCode" IS NOT NULL AND j."mergedIntoId" IS NULL
  WHERE coalesce((SELECT e.type FROM "JobEvent" e WHERE e."jobId" = j.id AND e.type IN ('CLOSED','WITHDRAWN','REOPENED','REPUBLISHED')
      AND e.at <= r.t ORDER BY e.at DESC LIMIT 1), 'REOPENED') IN ('REOPENED','REPUBLISHED')
    AND NOT EXISTS (SELECT 1 FROM "JobSource" autre WHERE autre."jobId" = j.id AND autre."firstSeenAt" <= r.t
      AND autre."sourceKey" <> k."sourceKey" AND NOT EXISTS (SELECT 1 FROM enechec k2 WHERE k2."runId" = r.id AND k2."sourceKey" = autre."sourceKey"))
  ORDER BY r.id, j.id, k."sourceKey")
SELECT json_build_object('bloc', 'menaces', 'lignes', coalesce(json_agg(x), '[]'::json)) FROM (
  SELECT run, "companyId" AS c, "countryCode" AS p, source, status AS statut, note, count(*)::int AS n, min(vu) AS vu
  FROM offre GROUP BY run, "companyId", "countryCode", source, status, note) x;

-- societes : libellés et fusions de société (les photographies suivent la Maison absorbante).
SELECT json_build_object('bloc', 'societes', 'lignes', coalesce(json_agg(x), '[]'::json)) FROM (
  SELECT c.id, c.name, c."mergedIntoId" AS fusion FROM "Company" c
  WHERE c."mergedIntoId" IS NOT NULL OR EXISTS (SELECT 1 FROM "Job" j WHERE j."companyId" = c.id)) x;

-- sources_connues : la dernière qualification validée de chaque source (7 jours), et ce qu'elle sert aujourd'hui.
WITH q AS (
  SELECT DISTINCT ON (cb."sourceKey") cb."sourceKey", (sv.report->>'qualified')::int AS qualifiees, sv."validatedAt"
  FROM "SourceValidation" sv JOIN "CaptureBatch" cb ON cb.id = sv."captureBatchId"
  WHERE sv.verdict = 'VALIDATED' AND sv."validatedAt" > (now() AT TIME ZONE 'UTC') - interval '7 days'
  ORDER BY cb."sourceKey", sv."validatedAt" DESC)
SELECT json_build_object('bloc', 'sources_connues', 'lignes', coalesce(json_agg(x), '[]'::json)) FROM (
  SELECT q."sourceKey" AS source, s.maison, s.status, s."careersDomain" AS domaine, q.qualifiees, q."validatedAt",
    (SELECT count(DISTINCT js."jobId")::int FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"
      WHERE js."sourceKey" = q."sourceKey" AND js."isActive" AND j."isActive" AND j."mergedIntoId" IS NULL) AS servies
  FROM q JOIN "Source" s ON s.key = q."sourceKey" WHERE q.qualifiees >= 10) x;
