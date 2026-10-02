-- D-520, critère 3 — catalogue des causes de non-normalité des sources sur 10 jours. LECTURE SEULE, hors fenêtre du RUN
-- (avant 15:30 ou après 18:30 UTC). Rejouable depuis le checkout qui porte les accès :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
--     'psql "$DATABASE_URL" -XA -F"|" -v ON_ERROR_STOP=1 -f <worktree>/audits/2026-10-02/remediation-auto/catalogue.sql' \
--     > <worktree>/audits/2026-10-02/remediation-auto/catalogue.csv
--   python3 <worktree>/audits/2026-10-02/remediation-auto/catalogue.py > <worktree>/audits/2026-10-02/remediation-auto/catalogue.out
-- (une session en lecture seule refuse les vues temporaires : la requête exporte les lignes classées, le script les agrège.)
-- Population : chaque `source.issue_classified` des RUN `ingest-all` (une ligne par source et par RUN, ses issues[]),
-- rapproché de l'événement d'échec du même RUN et de la même source (`source.failed`, `source.timed_out`,
-- `source.challenged`) qui porte le message et le code de l'erreur. Classe = règle unique (`classe` ci-dessous).
-- Offres en jeu = plus grand `SourceRun.jobs` de la source sur la fenêtre (ce qu'elle porte quand elle va bien).
\pset footer off
\pset format csv
SET statement_timeout = '120s';
SET default_transaction_read_only = on;
\set debut '''2026-09-22'''

WITH runs AS (
  SELECT id, "startedAt"::date AS jour, "startedAt" FROM "PipelineRun"
  WHERE command = 'ingest-all' AND "startedAt" >= :debut),
issues AS (
  SELECT r.id run, r.jour, r."startedAt", e."sourceKey" src, i->>'origin' origin, i->>'code' code, i->>'detail' detail, (i->>'count')::int n,
         coalesce((e.payload->>'knownFailure')::boolean, false) connu, coalesce((e.payload->>'acceptedNativeOnly')::boolean, false) natif
  FROM runs r JOIN "PipelineEvent" e ON e."runId" = r.id AND e.event = 'source.issue_classified'
  CROSS JOIN LATERAL jsonb_array_elements(e.payload->'issues') i),
fails AS (
  SELECT DISTINCT ON (e."runId", 2) e."runId" run,
         coalesce(e."sourceKey", substring(e.payload->>'message' from '^\[orchestrator\] ([^:]+):')) src, e.event,
         coalesce(e.payload#>>'{details,0,error,code}', e.payload#>>'{error,code}', '') ecode,
         coalesce(e.payload#>>'{details,0,error,name}', e.payload#>>'{error,name}', '') ename,
         left(coalesce(e.payload#>>'{details,0,error,message}', e.payload#>>'{error,message}', e.payload->>'message', ''), 300) msg
  FROM "PipelineEvent" e JOIN runs r ON r.id = e."runId"
  WHERE e.event IN ('source.ingest_failed', 'source.failed', 'source.timed_out', 'source.challenged')
  ORDER BY e."runId", 2, (e.event = 'source.ingest_failed') DESC, e.at)
SELECT i.run, i.jour, i."startedAt", i.src, i.origin, i.code, i.detail, i.n, i.connu, i.natif, f.event fail_event, f.ecode, f.ename, f.msg,
  CASE
    WHEN i.code = 'EmployerIdentityReviewRequired' OR f.msg ILIKE '%identity review%' THEN 'F1 identité d''employeur en revue'
    WHEN i.code = 'NATIVE_RETENTION' THEN 'A0 retenue prouvée par la source (normal, non bloquant)'
    WHEN f.msg LIKE '%Transaction already closed%' OR f.msg LIKE '%Transaction API error%' THEN 'E1 interne : base, capture, journal'
    WHEN f.msg LIKE '%cannot replace an explicit denial%' THEN 'A6 refus d''accès explicite en vigueur (décision humaine)'
    WHEN i.code = 'ACCESS_STALE' AND f.msg LIKE '%must be renewed%' THEN 'A1 décision d''accès à renouveler (révision, lecteur ou échéance)'
    WHEN i.code = 'ACCESS_STALE' THEN 'A2 décision d''accès d''une autre révision de source'
    WHEN i.code IN ('ACCESS_MISSING') THEN 'A3 décision d''accès absente'
    WHEN i.code IN ('ACCESS_SUPERSEDED') THEN 'A4 décision d''accès remplacée pendant la qualification'
    WHEN i.code = 'ACCESS_SCOPE' THEN 'A5 requête hors du périmètre qualifié (lecteur ou site changé)'
    WHEN f.ecode = 'CAPTURE_NOT_VALIDATED' OR f.msg LIKE 'Access qualification requires validated%' THEN 'B1 qualification refusée : capture non validée'
    WHEN f.msg = 'fetch failed' OR f.msg LIKE '__TIMEOUT__%' OR f.msg ~ '^HTTP 5' OR i.code LIKE 'TRANSPORT_%' OR i.code LIKE 'HTTP_5%' OR f.event = 'source.timed_out' OR i.code LIKE '%TIMEOUT%' THEN 'C1 passager : délai, transport ou 5xx'
    WHEN i.detail = 'HTTP_406' OR f.msg LIKE 'HTTP 406%' THEN 'C2 refus 406 (Avature)'
    WHEN i.detail IN ('HTTP_403', 'HTTP_429') OR f.msg ~ '^HTTP (403|429)' OR f.event = 'source.challenged' OR i.code LIKE 'Waf%' THEN 'C3 refus 403/429 ou anti-bot'
    WHEN i.detail LIKE 'HTTP_4%' OR f.msg ~ '^HTTP 4' THEN 'C4 autre 4xx (adresse disparue, lecteur)'
    WHEN i.code IN ('ENUMERATION_NOT_PROVEN', 'ENUMERATION_REFUTED') THEN 'D1 liste incomplète ou non prouvée'
    WHEN i.code IN ('SOURCE_HEALTH_REGRESSION', 'NATIVE_RETENTION_JUMP') OR i.code LIKE '%COVERAGE%' THEN 'D2 régression de santé (volume, champs)'
    WHEN i.code = 'DATABASE_FAILURE' OR i.code IN ('CaptureUnavailableError', 'OfflineReplayError', 'ObservabilityUnavailableError') THEN 'E1 interne : base, capture, journal'
    WHEN i.code IN ('TypeError', 'ReferenceError', 'RangeError') THEN 'E2 interne : défaut de code'
    WHEN f.ename = 'SourceAdmissionGateError' OR f.ename = 'SourceValidationGateError' THEN 'B2 admission ou validation refusée (autre motif)'
    WHEN i.code = 'UNCLASSIFIED_INGEST_ERRORS' THEN 'G1 erreurs d''ingestion non classées (offres isolées)'
    ELSE 'Z autre : ' || i.code || coalesce('/' || i.detail, '') END classe, (SELECT max(jobs) FROM "SourceRun" sr WHERE sr."sourceKey" = i.src AND sr."ranAt" >= :debut) offres
FROM issues i LEFT JOIN fails f ON f.run = i.run AND f.src = i.src
ORDER BY i."startedAt", i.src;
