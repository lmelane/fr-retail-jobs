-- R-143 §2 (D-513) — passage À BLANC de la disponibilité servie, en LECTURE SEULE sur la production.
-- Rejouer (racine du checkout de l'agrégateur qui porte les accès, jamais entre 15:30 et 18:30 UTC) :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F" | " -f <ce fichier>'
--
-- « Servie avant » = le filtre public de 279e2ec (`publicJobSql` : offre active, non fusionnée, une représentation
-- active non échue) + pays connu, comme la recherche. Trois règles comparées, au même instant :
--   A  plafond absolu : une représentation non revue depuis 72 h ne sert plus l'offre ;
--   C  relatif seul : une représentation que la dernière collecte CRÉDIBLE de sa source n'a pas vue ne sert plus ;
--   B  = C + A : la règle construite (`packages/db/availability.ts`, `apps/aggregator/src/pipeline/availability.ts`).
-- Collecte crédible, reproduite en SQL (le code lit le manifeste scellé ; approximations signalées) : la DERNIÈRE
-- tentative d'offres de la révision courante, source ACTIVE, admise, scellée EXTRACTED, achevée ; publiée > 0 ; non
-- tronquée, total annoncé non nul et lu à 90 % au moins (lus dans le SourceRun de la même collecte, approximation du
-- manifeste) ; pas d'effondrement (publiées >= moitié de la collecte productive précédente ; une chute confirmée par
-- l'éditeur, D-484 §2, n'est pas reconnue ici : approximation prudente, elle masque moins) ; garde : pas plus de la
-- moitié d'un stock d'au moins 10 représentations. « Vue » = parmi les sorties de la collecte (SourceExtraction) ; le
-- code y ajoute les identifiants rejetés ou seulement énumérés : le SQL peut compter quelques « manquées » de plus.
\timing on
SET statement_timeout = '120s';
SHOW default_transaction_read_only;

\echo D1 totaux : offres servies avant, et apres chaque regle
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
offre AS (
  SELECT j.id, j."companyId", j."countryCode", j."canonicalSourceKey",
    bool_or(r.dispo) servie_avant,
    bool_or(r.dispo AND r.recente) servie_a,
    bool_or(r.dispo AND NOT coalesce(r.manquee_retenue, false)) servie_c,
    bool_or(r.dispo AND r.recente AND NOT coalesce(r.manquee_retenue, false)) servie_b
  FROM "Job" j JOIN rep2 r ON r."jobId" = j.id
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL GROUP BY j.id)
SELECT count(*) FILTER (WHERE servie_avant) avant, count(*) FILTER (WHERE servie_a) apres_a_72h, count(*) FILTER (WHERE servie_c) apres_c_relatif, count(*) FILTER (WHERE servie_b) apres_b_construite, count(*) FILTER (WHERE servie_avant AND NOT servie_b AND servie_a) masquees_b_par_relatif_seul, count(*) FILTER (WHERE servie_avant AND NOT servie_b AND servie_c) masquees_b_par_plafond_seul FROM offre;

\echo D2 sources : collecte credible ou non, et garde de la moitie
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
offre AS (
  SELECT j.id, j."companyId", j."countryCode", j."canonicalSourceKey",
    bool_or(r.dispo) servie_avant,
    bool_or(r.dispo AND r.recente) servie_a,
    bool_or(r.dispo AND NOT coalesce(r.manquee_retenue, false)) servie_c,
    bool_or(r.dispo AND r.recente AND NOT coalesce(r.manquee_retenue, false)) servie_b
  FROM "Job" j JOIN rep2 r ON r."jobId" = j.id
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL GROUP BY j.id)
SELECT count(*) sources, count(*) FILTER (WHERE manquees > 0) avec_manquees, count(*) FILTER (WHERE stock >= 10 AND manquees > 0.5 * stock) gardees_moitie FROM garde;

\echo D3 sources gardees (plus de la moitie du stock manquee) : rien n est masque par le relatif
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
offre AS (
  SELECT j.id, j."companyId", j."countryCode", j."canonicalSourceKey",
    bool_or(r.dispo) servie_avant,
    bool_or(r.dispo AND r.recente) servie_a,
    bool_or(r.dispo AND NOT coalesce(r.manquee_retenue, false)) servie_c,
    bool_or(r.dispo AND r.recente AND NOT coalesce(r.manquee_retenue, false)) servie_b
  FROM "Job" j JOIN rep2 r ON r."jobId" = j.id
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL GROUP BY j.id)
SELECT "sourceKey", stock, manquees FROM garde WHERE stock >= 10 AND manquees > 0.5 * stock ORDER BY manquees DESC;

\echo D4 masquees par source canonique (regle B), 40 premieres
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
offre AS (
  SELECT j.id, j."companyId", j."countryCode", j."canonicalSourceKey",
    bool_or(r.dispo) servie_avant,
    bool_or(r.dispo AND r.recente) servie_a,
    bool_or(r.dispo AND NOT coalesce(r.manquee_retenue, false)) servie_c,
    bool_or(r.dispo AND r.recente AND NOT coalesce(r.manquee_retenue, false)) servie_b
  FROM "Job" j JOIN rep2 r ON r."jobId" = j.id
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL GROUP BY j.id)
SELECT "canonicalSourceKey", count(*) FILTER (WHERE servie_avant) servies, count(*) FILTER (WHERE servie_avant AND NOT servie_b) masquees, round(100.0 * count(*) FILTER (WHERE servie_avant AND NOT servie_b) / nullif(count(*) FILTER (WHERE servie_avant), 0), 1) pct, count(*) FILTER (WHERE servie_avant AND NOT servie_a) masquees_a FROM offre GROUP BY 1 HAVING count(*) FILTER (WHERE servie_avant AND NOT servie_b) > 0 ORDER BY 3 DESC LIMIT 40;

\echo D5 masquees par pays (regle B et regle A)
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
offre AS (
  SELECT j.id, j."companyId", j."countryCode", j."canonicalSourceKey",
    bool_or(r.dispo) servie_avant,
    bool_or(r.dispo AND r.recente) servie_a,
    bool_or(r.dispo AND NOT coalesce(r.manquee_retenue, false)) servie_c,
    bool_or(r.dispo AND r.recente AND NOT coalesce(r.manquee_retenue, false)) servie_b
  FROM "Job" j JOIN rep2 r ON r."jobId" = j.id
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL GROUP BY j.id)
SELECT "countryCode", count(*) FILTER (WHERE servie_avant) servies, count(*) FILTER (WHERE servie_avant AND NOT servie_b) masquees_b, round(100.0 * count(*) FILTER (WHERE servie_avant AND NOT servie_b) / nullif(count(*) FILTER (WHERE servie_avant), 0), 1) pct_b, count(*) FILTER (WHERE servie_avant AND NOT servie_a) masquees_a, round(100.0 * count(*) FILTER (WHERE servie_avant AND NOT servie_a) / nullif(count(*) FILTER (WHERE servie_avant), 0), 1) pct_a FROM offre GROUP BY 1 HAVING count(*) FILTER (WHERE servie_avant) >= 20 ORDER BY 4 DESC NULLS LAST;

\echo D6 Maisons (Company) qui perdraient plus de 30 % de leurs offres servies (regle B), au moins 5 servies
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
offre AS (
  SELECT j.id, j."companyId", j."countryCode", j."canonicalSourceKey",
    bool_or(r.dispo) servie_avant,
    bool_or(r.dispo AND r.recente) servie_a,
    bool_or(r.dispo AND NOT coalesce(r.manquee_retenue, false)) servie_c,
    bool_or(r.dispo AND r.recente AND NOT coalesce(r.manquee_retenue, false)) servie_b
  FROM "Job" j JOIN rep2 r ON r."jobId" = j.id
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL GROUP BY j.id)
SELECT c.name, count(*) FILTER (WHERE servie_avant) servies, count(*) FILTER (WHERE servie_avant AND NOT servie_b) masquees, round(100.0 * count(*) FILTER (WHERE servie_avant AND NOT servie_b) / nullif(count(*) FILTER (WHERE servie_avant), 0), 1) pct, count(*) FILTER (WHERE servie_avant AND NOT servie_a) masquees_a FROM offre JOIN "Company" c ON c.id = offre."companyId" GROUP BY 1 HAVING count(*) FILTER (WHERE servie_avant) >= 5 AND count(*) FILTER (WHERE servie_avant AND NOT servie_b) > 0.3 * count(*) FILTER (WHERE servie_avant) ORDER BY 2 DESC;

\echo D7 les memes Maisons, regle A (72 h seul)
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
offre AS (
  SELECT j.id, j."companyId", j."countryCode", j."canonicalSourceKey",
    bool_or(r.dispo) servie_avant,
    bool_or(r.dispo AND r.recente) servie_a,
    bool_or(r.dispo AND NOT coalesce(r.manquee_retenue, false)) servie_c,
    bool_or(r.dispo AND r.recente AND NOT coalesce(r.manquee_retenue, false)) servie_b
  FROM "Job" j JOIN rep2 r ON r."jobId" = j.id
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL GROUP BY j.id)
SELECT c.name, count(*) FILTER (WHERE servie_avant) servies, count(*) FILTER (WHERE servie_avant AND NOT servie_a) masquees_a, round(100.0 * count(*) FILTER (WHERE servie_avant AND NOT servie_a) / nullif(count(*) FILTER (WHERE servie_avant), 0), 1) pct_a FROM offre JOIN "Company" c ON c.id = offre."companyId" GROUP BY 1 HAVING count(*) FILTER (WHERE servie_avant) >= 5 AND count(*) FILTER (WHERE servie_avant AND NOT servie_a) > 0.3 * count(*) FILTER (WHERE servie_avant) ORDER BY 2 DESC;

\echo D8 sources silencieuses : offres servies dont aucune representation n est revue depuis 72 h (plafond), par source
SELECT js."sourceKey", s.status, s."lastRunStatus", to_char(max(js."lastSeenAt"),'MM-DD HH24:MI') derniere_vue, count(DISTINCT j.id) offres
FROM "Job" j JOIN "JobSource" js ON js."jobId" = j.id AND js."isActive" AND (js."expiresAt" IS NULL OR js."expiresAt" > (now() AT TIME ZONE 'UTC'))
LEFT JOIN "Source" s ON s.key = js."sourceKey"
WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "JobSource" o WHERE o."jobId" = j.id AND o."isActive" AND o."lastSeenAt" > (now() AT TIME ZONE 'UTC') - interval '72 hours')
GROUP BY 1,2,3 ORDER BY 5 DESC;

\echo D9 offres masquees par le plafond seul (aucune collecte credible ne les a manquees), par source canonique et statut
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
offre AS (
  SELECT j.id, j."companyId", j."countryCode", j."canonicalSourceKey",
    bool_or(r.dispo) servie_avant,
    bool_or(r.dispo AND r.recente) servie_a,
    bool_or(r.dispo AND NOT coalesce(r.manquee_retenue, false)) servie_c,
    bool_or(r.dispo AND r.recente AND NOT coalesce(r.manquee_retenue, false)) servie_b
  FROM "Job" j JOIN rep2 r ON r."jobId" = j.id
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL GROUP BY j.id)
SELECT o."canonicalSourceKey", s.status, s."lastRunStatus", count(*) FROM offre o LEFT JOIN "Source" s ON s.key = o."canonicalSourceKey"
WHERE servie_avant AND NOT servie_b AND servie_c GROUP BY 1,2,3 ORDER BY 4 DESC;

\echo D10 Maisons entierement masquees (regle B) : source et motif
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
offre AS (
  SELECT j.id, j."companyId", j."countryCode", j."canonicalSourceKey",
    bool_or(r.dispo) servie_avant,
    bool_or(r.dispo AND r.recente) servie_a,
    bool_or(r.dispo AND NOT coalesce(r.manquee_retenue, false)) servie_c,
    bool_or(r.dispo AND r.recente AND NOT coalesce(r.manquee_retenue, false)) servie_b
  FROM "Job" j JOIN rep2 r ON r."jobId" = j.id
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL GROUP BY j.id)
SELECT c.name, o."canonicalSourceKey", s.status, count(*) servies, bool_and(NOT servie_a) toutes_plafond FROM offre o JOIN "Company" c ON c.id = o."companyId" LEFT JOIN "Source" s ON s.key = o."canonicalSourceKey"
WHERE servie_avant GROUP BY 1,2,3 HAVING bool_and(NOT servie_b) AND count(*) >= 3 ORDER BY 4 DESC;

\echo D11 marches au-dela de 30 % (ZA, HU) : masquees par source canonique
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
offre AS (
  SELECT j.id, j."companyId", j."countryCode", j."canonicalSourceKey",
    bool_or(r.dispo) servie_avant,
    bool_or(r.dispo AND r.recente) servie_a,
    bool_or(r.dispo AND NOT coalesce(r.manquee_retenue, false)) servie_c,
    bool_or(r.dispo AND r.recente AND NOT coalesce(r.manquee_retenue, false)) servie_b
  FROM "Job" j JOIN rep2 r ON r."jobId" = j.id
  WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL GROUP BY j.id)
SELECT "countryCode", "canonicalSourceKey", count(*) FILTER (WHERE servie_avant) servies, count(*) FILTER (WHERE servie_avant AND NOT servie_b) masquees
FROM offre WHERE "countryCode" IN ('ZA','HU') GROUP BY 1,2 HAVING count(*) FILTER (WHERE servie_avant AND NOT servie_b) > 0 ORDER BY 1, 4 DESC;
