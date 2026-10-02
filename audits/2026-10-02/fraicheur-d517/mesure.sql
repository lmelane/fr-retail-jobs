-- D-517 — sélection par importance et coût d'une lecture incrémentale. Production, LECTURE SEULE, hors fenêtre du RUN
-- (15:30-18:30 UTC). Rejouer depuis la racine du dépôt (sortie dans ce dossier) :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F "|" -f audits/2026-10-02/fraicheur-d517/mesure.sql' > audits/2026-10-02/fraicheur-d517/mesure.out
-- « Nouvelle offre » = une ligne `JobSource` vue pour la première fois (une publication que la source n'avait jamais
-- montrée), sur les 7 jours pleins précédant le dernier RUN achevé ; une source enregistrée pendant la fenêtre n'y
-- compte pas (son stock n'est pas un flux).

\echo F0 le dernier RUN achevé et la fenêtre de 7 jours
SELECT id, to_char("startedAt",'YYYY-MM-DD HH24:MI') debut, to_char("finishedAt",'YYYY-MM-DD HH24:MI') fin, status
FROM "PipelineRun" WHERE command='ingest-all' AND "finishedAt" IS NOT NULL ORDER BY "startedAt" DESC LIMIT 1;

\echo F1 nouvelles publications par source ACTIVE et par jour (7 jours pleins) — la règle de sélection lue par la passe
WITH fin AS (SELECT date_trunc('day', max("startedAt")) t FROM "PipelineRun" WHERE command='ingest-all' AND "finishedAt" IS NOT NULL),
premiere AS (SELECT "sourceKey", min("firstSeenAt") p FROM "JobSource" GROUP BY 1),
flux AS (SELECT js."sourceKey" sk, count(*) n FROM "JobSource" js, fin
         WHERE js."firstSeenAt" >= fin.t - interval '7 days' AND js."firstSeenAt" < fin.t GROUP BY 1)
SELECT s.key, s.kind, s."lastRunStatus", coalesce(flux.n,0) nouvelles_7j, round(coalesce(flux.n,0)/7.0,1) par_jour,
  (premiere.p < (SELECT t FROM fin) - interval '7 days') ancienne,
  (SELECT count(*) FROM "JobSource" k WHERE k."sourceKey"=s.key) connues
FROM "Source" s LEFT JOIN flux ON flux.sk=s.key LEFT JOIN premiere ON premiere."sourceKey"=s.key
WHERE s.status='ACTIVE' ORDER BY 4 DESC, 1;

\echo F2 requêtes de la collecte d offres du dernier RUN (sous décision d accès), par source et par forme d adresse
WITH last AS (SELECT id FROM "PipelineRun" WHERE command='ingest-all' AND "finishedAt" IS NOT NULL ORDER BY "startedAt" DESC LIMIT 1)
SELECT cb."sourceKey" sk, cb."sourceKind" kind, rc.method,
  regexp_replace(regexp_replace(split_part(rc."requestUrl", '?', 1), '/[^/]*[0-9][^/]*', '/#', 'g'), '^https?://[^/]+', '') forme,
  count(*) requetes
FROM "CaptureBatch" cb JOIN last ON last.id=cb."runId" JOIN "RawCapture" rc ON rc."batchId"=cb.id
WHERE cb.purpose='JOBS' AND cb."accessDecisionId" IS NOT NULL
GROUP BY 1,2,3,4 HAVING count(*) >= 2 ORDER BY 1, 5 DESC;

\echo F3 ordre des listes : rang des publications nouvelles dans la sortie de la collecte du RUN (3 derniers RUN)
WITH runs AS (SELECT id FROM "PipelineRun" WHERE command='ingest-all' AND "finishedAt" IS NOT NULL ORDER BY "startedAt" DESC LIMIT 3),
b AS (SELECT cb.id, cb."sourceKey", cb."startedAt", o."extractedCount" n FROM "CaptureBatch" cb JOIN runs ON runs.id=cb."runId"
      JOIN "CaptureOutcome" o ON o."batchId"=cb.id WHERE cb.purpose='JOBS' AND cb."accessDecisionId" IS NOT NULL AND o.status='EXTRACTED' AND o."extractedCount" >= 50),
nv AS (SELECT b."sourceKey" sk, b.id, b.n, se.ordinal::numeric / b.n rang FROM b
       JOIN "SourceExtraction" se ON se."batchId"=b.id
       JOIN "JobSource" js ON js."sourceKey"=b."sourceKey" AND js."externalId"=se."externalId"
       WHERE js."firstSeenAt" >= b."startedAt" AND js."firstSeenAt" < b."startedAt" + interval '8 hours')
SELECT sk, count(DISTINCT id) collectes, round(avg(n)) sorties, count(*) nouvelles,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY rang)::numeric,2) rang_med,
  round(percentile_cont(0.9) WITHIN GROUP (ORDER BY rang)::numeric,2) rang_p90, round(max(rang),2) rang_max
FROM nv GROUP BY 1 HAVING count(*) >= 5 ORDER BY 4 DESC;

\echo F4 la règle exacte de la passe (significantSources, lightPass.ts) à l instant de la mesure : flux d au moins 1 par jour, mesuré depuis le lendemain du premier chargement d une source enregistrée dans la fenêtre
WITH bornes AS (SELECT now() t, now() - interval '7 days' since),
premiere AS (SELECT "sourceKey", min("firstSeenAt") p FROM "JobSource" GROUP BY 1),
debut AS (SELECT premiere."sourceKey", greatest(bornes.since, premiere.p + interval '1 day') d FROM premiere, bornes),
flux AS (SELECT js."sourceKey", count(*) n FROM "JobSource" js JOIN debut ON debut."sourceKey"=js."sourceKey", bornes
         WHERE js."firstSeenAt" >= debut.d AND js."firstSeenAt" < bornes.t GROUP BY 1)
SELECT s.key, s.kind, flux.n, round(extract(epoch FROM (bornes.t - debut.d))/86400, 2) jours,
  round(flux.n / (extract(epoch FROM (bornes.t - debut.d))/86400), 1) par_jour,
  (flux.n / (extract(epoch FROM (bornes.t - debut.d))/86400) >= 1 AND bornes.t - debut.d >= interval '1 day') retenue
FROM "Source" s JOIN flux ON flux."sourceKey"=s.key JOIN debut ON debut."sourceKey"=s.key, bornes
WHERE s.status='ACTIVE' ORDER BY 5 DESC NULLS LAST, 1;
