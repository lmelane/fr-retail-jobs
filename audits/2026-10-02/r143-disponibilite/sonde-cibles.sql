-- R-143 §2 — les cibles de la sonde des liens « Postuler » (à blanc) : représentations encore confirmées par la règle B
-- (`confirmedSourceWhere`), d'offres servies, non revues depuis 24 h, avec le périmètre d'accès revu de leur source et un
-- témoin (la représentation confirmée la plus récente de la même source, comme `witnessFor`). Sortie JSON lue par `sonde-a-blanc.mts`.
SET statement_timeout = '120s';
\t on
\pset format unaligned
WITH att AS (
  SELECT DISTINCT ON (cb."sourceKey") cb."sourceKey" k, cb.id b, cb."startedAt" t, cb."runId",
    (s.status = 'ACTIVE' AND a."batchId" IS NOT NULL AND o.status = 'EXTRACTED' AND o."manifestHash" IS NOT NULL AND c."batchId" IS NOT NULL) achevee,
    c.published, o."extractedCount" fetched, c."completedAt"
  FROM "CaptureBatch" cb JOIN "Source" s ON s.key = cb."sourceKey" AND cb."sourceRevisionId" = s."currentRevisionId"
  LEFT JOIN "SourceIngestionAdmission" a ON a."batchId" = cb.id LEFT JOIN "CaptureOutcome" o ON o."batchId" = cb.id
  LEFT JOIN "SourceIngestionCompletion" c ON c."batchId" = cb.id
  WHERE cb.purpose = 'JOBS' AND cb."attemptOrdinal" IS NOT NULL ORDER BY cb."sourceKey", cb."attemptOrdinal" DESC),
faits AS (
  SELECT att.*,
    (SELECT p.published FROM "SourceIngestionCompletion" p JOIN "CaptureBatch" pb ON pb.id = p."batchId"
      WHERE pb."sourceKey" = att.k AND p.published > 0 AND p."completedAt" < att."completedAt" AND p."batchId" <> att.b
      ORDER BY p."completedAt" DESC LIMIT 1) precedente,
    (SELECT r."declaredTotal" FROM "SourceRun" r WHERE r."sourceKey" = att.k AND r."ranAt" >= att.t ORDER BY r."ranAt" LIMIT 1) annonce,
    (SELECT r.truncated FROM "SourceRun" r WHERE r."sourceKey" = att.k AND r."ranAt" >= att.t ORDER BY r."ranAt" LIMIT 1) tronquee
  FROM att),
credible0 AS (
  SELECT k, b, t, achevee AND published > 0 AND coalesce(tronquee, false) = false AND coalesce(annonce, -1) <> 0
    AND (annonce IS NULL OR fetched >= 0.9 * annonce) AND (precedente IS NULL OR published >= 0.5 * precedente) credible_collecte
  FROM faits),
rep AS (
  SELECT js.id, js."jobId", js."sourceKey", js."lastSeenAt",
    (js."expiresAt" IS NULL OR js."expiresAt" > (now() AT TIME ZONE 'UTC')) dispo,
    js."lastSeenAt" > (now() AT TIME ZONE 'UTC') - interval '72 hours' recente,
    c.credible_collecte AND js."lastSeenAt" < c.t AND NOT EXISTS (SELECT 1 FROM "SourceExtraction" e WHERE e."batchId" = c.b AND e."externalId" = js."externalId") manquee
  FROM "JobSource" js LEFT JOIN credible0 c ON c.k = js."sourceKey" WHERE js."isActive"),
garde AS (SELECT "sourceKey", count(*) stock, count(*) FILTER (WHERE manquee) manquees FROM rep GROUP BY 1),
rep2 AS (
  SELECT rep.*, rep.manquee AND NOT (g.stock >= 10 AND g.manquees > 0.5 * g.stock) manquee_retenue
  FROM rep JOIN garde g USING ("sourceKey")),
cible AS (
  SELECT r.id, r."sourceKey", js.url, r."lastSeenAt" FROM rep2 r JOIN "JobSource" js ON js.id = r.id JOIN "Job" j ON j.id = r."jobId"
  WHERE r.dispo AND r.recente AND NOT coalesce(r.manquee_retenue, false) AND r."lastSeenAt" < (now() AT TIME ZONE 'UTC') - interval '24 hours'
    AND j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL),
temoin AS (
  SELECT DISTINCT ON (r."sourceKey") r."sourceKey", js.url FROM rep2 r JOIN "JobSource" js ON js.id = r.id
  WHERE r.dispo AND r.recente AND NOT coalesce(r.manquee_retenue, false)
  ORDER BY r."sourceKey", r."lastSeenAt" DESC),
acces AS (
  SELECT DISTINCT ON ("sourceKey") "sourceKey", document->'scopes' scopes, document->>'verdict' verdict FROM "SourceAccessDecision"
  WHERE "sourceKey" IN (SELECT "sourceKey" FROM cible) ORDER BY "sourceKey", sequence DESC)
SELECT json_build_object('cibles', (SELECT json_agg(json_build_object('id', id, 'sourceKey', "sourceKey", 'url', url, 'lastSeenAt', "lastSeenAt") ORDER BY "lastSeenAt") FROM cible),
  'temoins', (SELECT json_object_agg("sourceKey", url) FROM temoin WHERE "sourceKey" IN (SELECT "sourceKey" FROM cible)),
  'acces', (SELECT json_object_agg("sourceKey", json_build_object('verdict', verdict, 'scopes', scopes)) FROM acces));
