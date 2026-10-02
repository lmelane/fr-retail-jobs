-- R-143 §1 (fraîcheur de la découverte) — coût et rendement de chaque source active, pour choisir une cadence.
-- Production, LECTURE SEULE, hors fenêtre du RUN (15:30-18:30 UTC). Rejouer depuis le checkout de référence :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F "|" -f audits/2026-10-02/cadence-r143/mesure-sources.sql'
-- Population : les RUN quotidiens (`PipelineRun.command = 'ingest-all'`) des 7 derniers jours, et les sources ACTIVE.
-- « nouvelle offre » = `Job` créé (`firstSeenAt`), non fusionné, de source canonique déjà présente avant le 24/09
-- (le catalogue a été rechargé du 18 au 23/09 : ces jours-là, « nouveau » ne veut pas dire « publié »).

\echo M0 RUN quotidiens des 7 derniers jours : durée et statut
SELECT to_char("startedAt",'MM-DD HH24:MI') AS debut, to_char("finishedAt",'MM-DD HH24:MI') AS fin, status,
  round(extract(epoch FROM ("finishedAt"-"startedAt"))/60) AS minutes,
  round(((metrics->'resources'->'after'->>'cpuUserUs')::numeric)/1e6) AS cpu_user_s,
  (metrics->'resources'->'peak'->>'dbTotal') AS connexions_pic
FROM "PipelineRun" WHERE command='ingest-all' AND "startedAt" > now()-interval '7 days 2 hours' ORDER BY "startedAt";

\echo M1 par source ACTIVE, sur les RUN des 7 derniers jours (events source_sync_completed)
WITH r AS (SELECT id FROM "PipelineRun" WHERE command='ingest-all' AND "startedAt" > now()-interval '7 days 2 hours'),
ev AS (
  SELECT e."sourceKey" sk, (e.payload->>'durationMs')::numeric/1000 dur_s,
    (e.payload->'stats'->0->>'fetchMs')::numeric/1000 fetch_s, (e.payload->'stats'->0->>'upsertMs')::numeric/1000 upsert_s,
    coalesce((e.payload->'http'->>'http.attempts')::int,0) req, (e.payload->>'fetched')::int fetched, (e.payload->>'created')::int created,
    (e.payload->'stats'->0->>'complete')::boolean complete
  FROM "PipelineEvent" e JOIN r ON r.id=e."runId" WHERE e.event='source_sync_completed')
SELECT s.key, s.kind, s.tier, count(ev.sk) runs,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur_s)::numeric,1) dur_med_s,
  round(max(dur_s),0) dur_max_s,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY fetch_s)::numeric,1) fetch_med_s,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY upsert_s)::numeric,1) upsert_med_s,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY req)::numeric) req_med,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY fetched)::numeric) offres_lues_med,
  sum(created) creees_7j, bool_and(complete) toujours_complete, s."lastRunStatus"
FROM "Source" s LEFT JOIN ev ON ev.sk=s.key WHERE s.status='ACTIVE'
GROUP BY s.key, s.kind, s.tier, s."lastRunStatus" ORDER BY sum(created) DESC NULLS LAST, s.key;

\echo M2 par source, collecte d offres du dernier RUN : requêtes capturées, octets reçus (corps décompressés), nature des réponses
WITH last AS (SELECT id FROM "PipelineRun" WHERE command='ingest-all' AND status <> 'RUNNING' ORDER BY "startedAt" DESC LIMIT 1)
SELECT cb."sourceKey" sk, cb."sourceKind" kind, count(rc.id) requetes,
  round(sum(coalesce(b."byteLength",0))/1048576.0,2) mio,
  count(*) FILTER (WHERE rc.headers->>'content-type' ~* 'json|xml') json_xml,
  count(*) FILTER (WHERE rc.headers->>'content-type' ~* 'html') html,
  round(extract(epoch FROM (max(rc."capturedAt")-min(rc."capturedAt"))))::int capture_s
FROM "CaptureBatch" cb JOIN last ON last.id=cb."runId" JOIN "RawCapture" rc ON rc."batchId"=cb.id LEFT JOIN "RawBlob" b ON b.hash=rc."blobHash"
WHERE cb.purpose='JOBS' GROUP BY 1,2 ORDER BY 3 DESC;

\echo M3 nouvelles offres par jour et par source canonique (sources présentes avant le 24/09, offres vues depuis le 25/09)
WITH anciennete AS (SELECT "sourceKey", min("firstSeenAt") premiere FROM "JobSource" GROUP BY 1),
n AS (SELECT j."canonicalSourceKey" sk, j."firstSeenAt", j."postedAt",
        extract(epoch FROM (j."firstSeenAt"-j."postedAt"))/3600 h, j."postedAt" = date_trunc('day', j."postedAt") jour_seul
      FROM "Job" j JOIN anciennete a ON a."sourceKey"=j."canonicalSourceKey"
      WHERE a.premiere < '2026-09-24' AND j."firstSeenAt" >= '2026-09-25' AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL)
SELECT sk, count(*) offres, round(count(*)/(extract(epoch FROM (now()-'2026-09-25'::timestamptz))/86400)::numeric,1) par_jour,
  count(*) FILTER (WHERE h >= 0 AND NOT jour_seul) horodatees,
  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY h) FILTER (WHERE h>=0))::numeric,1) med_h,
  round((percentile_cont(0.9) WITHIN GROUP (ORDER BY h) FILTER (WHERE h>=0))::numeric,1) p90_h
FROM n GROUP BY 1 ORDER BY 2 DESC;

\echo M4 total des nouvelles offres de la population M3 (le dénominateur de la projection)
WITH anciennete AS (SELECT "sourceKey", min("firstSeenAt") premiere FROM "JobSource" GROUP BY 1)
SELECT count(*) offres, count(*) FILTER (WHERE j."postedAt" IS NULL) sans_date,
  count(*) FILTER (WHERE j."firstSeenAt" < j."postedAt") date_apres_obs,
  count(*) FILTER (WHERE j."postedAt" = date_trunc('day', j."postedAt")) date_jour_seul
FROM "Job" j JOIN anciennete a ON a."sourceKey"=j."canonicalSourceKey"
WHERE a.premiere < '2026-09-24' AND j."firstSeenAt" >= '2026-09-25' AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL;
