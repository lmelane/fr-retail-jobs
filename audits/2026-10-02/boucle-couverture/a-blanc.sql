-- R-143 §2 à blanc, vu par l'alerte de couverture (D-516 §2) : ce que la PREMIÈRE revue de disponibilité masquerait,
-- par société et pays, avec sa cause. LECTURE SEULE. Même règle, mot pour mot, que
-- `audits/2026-10-02/r143-disponibilite/disponibilite-a-blanc.sql` (bloc D1, approximations signalées là-bas) :
--   masquée par le relatif (une collecte crédible ne la liste plus)  -> cause NON_REVUE
--   masquée par le seul plafond de 72 h (source active sans collecte crédible) -> cause COLLECTE
-- Rejouer : python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
--   'psql "$DATABASE_URL" -X -A -t -q -v ON_ERROR_STOP=1 -f audits/2026-10-02/boucle-couverture/a-blanc.sql' \
--   | gzip -9 > audits/2026-10-02/boucle-couverture/a-blanc.json.gz
SET statement_timeout = '180s';
SET default_transaction_read_only = on;
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
    (SELECT r.truncated FROM "SourceRun" r WHERE r."sourceKey" = att.k AND r."ranAt" >= att.t ORDER BY r."ranAt" LIMIT 1) tronquee,
    (SELECT r.complete FROM "SourceRun" r WHERE r."sourceKey" = att.k AND r."ranAt" >= att.t ORDER BY r."ranAt" LIMIT 1) complete
  FROM att),
credible0 AS (
  SELECT k, b, t, achevee AND published > 0 AND coalesce(tronquee, false) = false AND coalesce(annonce, -1) <> 0
    AND complete IS DISTINCT FROM false AND (complete IS TRUE OR (annonce > 0 AND fetched >= 0.9 * annonce))
    AND (precedente IS NULL OR published >= 0.5 * precedente) credible_collecte
  FROM faits),
rep AS (
  SELECT js.id, js."jobId", js."sourceKey", js."lastSeenAt",
    (js."expiresAt" IS NULL OR js."expiresAt" > (now() AT TIME ZONE 'UTC')) dispo,
    js."lastSeenAt" > (now() AT TIME ZONE 'UTC') - interval '72 hours' OR coalesce((SELECT x.status::text FROM "Source" x WHERE x.key = js."sourceKey"), '') <> 'ACTIVE' recente,
    c.credible_collecte AND js."lastSeenAt" < c.t AND NOT EXISTS (SELECT 1 FROM "SourceExtraction" e WHERE e."batchId" = c.b AND e."externalId" = js."externalId") manquee
  FROM "JobSource" js LEFT JOIN credible0 c ON c.k = js."sourceKey" WHERE js."isActive"),
garde AS (SELECT "sourceKey", count(*) stock, count(*) FILTER (WHERE manquee) manquees FROM rep GROUP BY 1),
rep2 AS (
  SELECT rep.*, rep.manquee AND NOT (g.stock >= 10 AND g.manquees > 0.5 * g.stock) manquee_retenue
  FROM rep JOIN garde g USING ("sourceKey")),
offre AS (
  SELECT j.id, j."companyId", j."countryCode", j."canonicalSourceKey",
    bool_or(r.dispo) servie_avant,
    bool_or(r.dispo AND r.recente) servie_a,
    bool_or(r.dispo AND NOT coalesce(r.manquee_retenue, false)) servie_c,
    bool_or(r.dispo AND r.recente AND NOT coalesce(r.manquee_retenue, false)) servie_b
  FROM "Job" j JOIN rep2 r ON r."jobId" = j.id
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL GROUP BY j.id)
SELECT json_build_object('bloc', 'a_blanc', 'mesure', now() AT TIME ZONE 'UTC', 'lignes', coalesce(json_agg(x), '[]'::json)) FROM (
  SELECT "companyId" AS c, "countryCode" AS p, "canonicalSourceKey" AS source,
    count(*) FILTER (WHERE servie_avant)::int AS servies,
    count(*) FILTER (WHERE servie_avant AND NOT servie_c)::int AS non_revue,
    count(*) FILTER (WHERE servie_avant AND servie_c AND NOT servie_b)::int AS plafond_seul
  FROM offre GROUP BY 1, 2, 3) x;
