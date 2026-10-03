-- D-523 (03/10/2026) : sources ACTIVE dont la dernière collecte complète (hors passe incrémentale D-517) n'a publié
-- aucune offre, classées zéro prouvé / zéro non prouvé ; leur état opérationnel et leur dernière validation native.
-- Lecture seule, requêtes légères : python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F"|" -f <ce fichier>'
-- :borne = début du RUN en cours (les collectes de ce RUN ne sont pas encore toutes là).
\set borne '''2026-10-03 06:47:49'''
WITH derniere AS (
  SELECT DISTINCT ON (r."sourceKey") r.*
  FROM "SourceRun" r JOIN "Source" s ON s.key = r."sourceKey" AND s.status = 'ACTIVE'
  WHERE r."ranAt" < :borne AND coalesce(r.note, '') NOT LIKE 'lecture incrémentale%'
  ORDER BY r."sourceKey", r."ranAt" DESC
), validation AS (
  SELECT DISTINCT ON (s.key) s.key, v.verdict, v.report->'reasons' AS reasons, v."validatedAt"
  FROM "Source" s JOIN "SourceValidation" v ON v."sourceRevisionId" = s."currentRevisionId"
  WHERE s.status = 'ACTIVE' ORDER BY s.key, v.sequence DESC
)
SELECT d."sourceKey", s.kind, d.status AS run_status, d.jobs, d.fetched, d."declaredTotal", d.complete, d.truncated, d.errors,
  CASE
    WHEN d.jobs > 0 THEN 'PUBLIE'
    WHEN coalesce(d.errors, 0) > 0 THEN 'ECHEC'
    WHEN d.fetched > 0 THEN 'TOUT_RETENU'
    WHEN d.complete IS TRUE AND d."declaredTotal" = 0 AND d.truncated IS NOT TRUE THEN 'ZERO_PROUVE_ANNONCE'
    WHEN d.complete IS TRUE AND d."declaredTotal" IS NULL AND d.truncated IS NOT TRUE THEN 'ZERO_PROUVE_LISTE'
    ELSE 'ZERO_NON_PROUVE' END AS classe,
  st.state, st.cause, st.trajectory, st.escalated, v.verdict AS validation, v.reasons AS raisons_validation,
  d."ranAt", left(d.note, 140) AS note
FROM derniere d JOIN "Source" s ON s.key = d."sourceKey"
LEFT JOIN "SourceOperationalState" st ON st."sourceKey" = d."sourceKey"
LEFT JOIN validation v ON v.key = d."sourceKey"
WHERE d.jobs = 0
ORDER BY classe, d."sourceKey";

-- Les sources ACTIVE sans aucune collecte complète avant la borne (nouvelles ou jamais collectées).
SELECT s.key, s.kind, s."lastRunStatus", s."lastRunJobs" FROM "Source" s
WHERE s.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM "SourceRun" r WHERE r."sourceKey" = s.key AND r."ranAt" < :borne
  AND coalesce(r.note, '') NOT LIKE 'lecture incrémentale%');

-- Les validations natives REJETÉES pour flux vide, toutes sources (la dernière par révision courante).
SELECT s.key, s.status, s.kind, v.verdict, v.report->'reasons' AS reasons, v.report->>'observed' AS observed, v."validatedAt"
FROM "Source" s JOIN LATERAL (SELECT * FROM "SourceValidation" v WHERE v."sourceRevisionId" = s."currentRevisionId"
  ORDER BY v.sequence DESC LIMIT 1) v ON true
WHERE v.report->'reasons' ? 'EMPTY_FEED_NOT_NATIVELY_PROVEN' ORDER BY s.status, s.key;

-- Les sources non ACTIVE : intention, trajectoire, fondement et motif du registre explicite, pour repérer une pause
-- ou un retrait posé pour seul volume nul.
SELECT key, status, "statusIntention", "statusTrajectory", "statusBasis", left("statusReason", 200) AS motif
FROM "Source" WHERE status IN ('PAUSED', 'RETIRED')
  AND ("statusReason" ~* '(z[ée]ro|aucune offre|sans offre|absence d.offres|flux vide|catalogue vide|empty|ne publie|\m0 offre)' OR note ~* '(z[ée]ro|aucune offre|sans offre|flux vide|empty|\m0 offre)')
ORDER BY status, key;
