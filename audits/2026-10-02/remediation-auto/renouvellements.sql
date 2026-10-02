-- D-520 — ce que le RUN absorbe déjà seul : les requalifications d'accès et de qualification native, par motif et par
-- jour, et leurs échecs. Et l'état des décisions d'accès au regard de la release qui tourne. LECTURE SEULE, hors
-- fenêtre du RUN. Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
--     'psql "$DATABASE_URL" -XA -F"|" -f <worktree>/audits/2026-10-02/remediation-auto/renouvellements.sql' > renouvellements.out
\pset footer off
SET statement_timeout = '120s';
-- 1. Requalifications d'accès lancées par le RUN (`maintainSourceAccess`), par jour, commande et motif ; et achevées.
SELECT p."startedAt"::date jour, p.command, e.event, coalesce(e.payload->>'reason', '') motif, count(*) n, count(DISTINCT e."sourceKey") sources
FROM "PipelineEvent" e JOIN "PipelineRun" p ON p.id = e."runId"
WHERE e.at >= '2026-09-22' AND e.event IN ('source.access_qualification_started', 'source.access_qualification_completed', 'source.native_qualification_started', 'source.access_scope_outgrown')
GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4;
-- 2. Les releases vues par les RUN (révision de `PipelineRun`), et quand elles ont changé.
SELECT revision, min("startedAt") premier, max("startedAt") dernier, count(*) runs, string_agg(DISTINCT command, ',') commandes
FROM "PipelineRun" WHERE "startedAt" >= '2026-09-22' AND revision IS NOT NULL GROUP BY 1 ORDER BY 2;
-- 3. Les décisions d'accès les plus récentes des sources ACTIVE : leur lecteur, au regard de la dernière révision vue.
WITH derniere AS (SELECT revision FROM "PipelineRun" WHERE revision IS NOT NULL ORDER BY "startedAt" DESC LIMIT 1),
d AS (SELECT DISTINCT ON (a."sourceKey") a."sourceKey", a."readerRevision", a.verdict, a."validUntil", a."sourceRevisionId", s."currentRevisionId"
      FROM "SourceAccessDecision" a JOIN "Source" s ON s.key = a."sourceKey" AND s.status = 'ACTIVE' ORDER BY a."sourceKey", a.sequence DESC)
SELECT (SELECT revision FROM derniere) derniere_revision,
       count(*) sources_actives_avec_decision,
       count(*) FILTER (WHERE d."readerRevision" = 'git:' || (SELECT revision FROM derniere)) meme_lecteur,
       count(*) FILTER (WHERE d."sourceRevisionId" <> d."currentRevisionId") autre_revision_source,
       count(*) FILTER (WHERE d."validUntil" < now()) expirees,
       count(*) FILTER (WHERE d.verdict <> 'ALLOWED') refus
FROM d;
