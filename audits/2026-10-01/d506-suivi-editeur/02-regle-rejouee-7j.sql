-- D-506 §3, mesure en lecture seule : ce que la règle « l'offre suit l'éditeur vers un employeur déjà publié par sa
-- source » aurait décidé sur chaque refus « changement d'employeur » des RUN ingest-all des 7 derniers jours.
--
-- Pour chaque refus (offre O, libellé déclaré B, au RUN R) :
--   · précédent natif : la dernière observation attribuée de O avant le refus ne vient pas du registre
--     (`SOURCE_CATALOGUE_LABEL`, portail certifié) ; sinon l'éditeur ne nommait pas d'employeur avant : ce n'est pas un
--     changement chez l'éditeur, la revue reste ;
--   · témoins (comme le code) : les AUTRES offres de la capture de R que l'éditeur y nomme encore B, et dont la
--     dernière observation AVANT LE DÉBUT DE CETTE CAPTURE porte le libellé B et un employeur attribué E : un employeur
--     apparu dans la même collecte ne témoigne pas, une offre renommée pendant la collecte non plus ;
--   · changement chez l'éditeur : précédent natif et employeur visé (E, ou inconnu sans témoin) différent du courant ;
--   · suivie : un changement chez l'éditeur avec au moins un témoin ;
--   · garde de masse : au-delà de max(5, 5 % des offres collectées par la source dans R) changements chez l'éditeur
--     dans le même RUN, suivables ou non, aucune offre ne suit, toutes restent en revue.
-- Approximations, dites : le libellé « dans la collecte » d'un témoin est celui de son observation pendant le RUN, ou à
-- défaut (observation identique, non réécrite) celui d'avant ; E est l'employeur des témoins, que
-- le résolveur donne aussi à O (même source, même libellé, aucun alias revu puisque O a été refusée) ; l'employeur
-- courant est comparé par son nom (`proposedName` du refus).
-- Usage : python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f <ce fichier>'
--
-- Résultat du 01/10/2026 vers 21:00 UTC (RUN ingest-all du 25/09 au 01/10 ; aucun refus de ce type le 30/09) :
-- 359 refus (offre × RUN), tous EMPLOYER_SPELLING_DIVERGED, aucun EMPLOYER_TARGET_MISMATCH.
--   · 7 refus, soit 4 offres distinctes, auraient suivi l'éditeur sans revue, chacun seul dans sa source et son RUN
--     (garde jamais atteinte) : swatch-group Flik Flak → Swatch ×4 RUN (26-29/09, 77 à 85 témoins ; réglé depuis par
--     l'alias de D-480 §2), richemont-workday Richemont → Cartier (29/09, 111 témoins ; réglé par l'alias D-479),
--     puma PUMA SE → PUMA North America, Inc. (01/10, 216 ; réglé par l'alias de D-506 §2), richemont Richemont →
--     Cartier (01/10, 36) ; soit 7 sources × RUN qui n'auraient plus été bloquées pour ce motif.
--   · 352 restent en revue : 351 dont le précédent venait du registre (b-s-international 55-56 par RUN, funky-buddha
--     13-15 par RUN, 5 RUN chacune ; elles auraient de toute façon franchi la garde : 56 > 5 sur 60, 15 > 5 sur 25) et
--     1 vers un employeur sans témoin dans la collecte (tapestry, « Tapestry, Inc. », 26/09 : 4 offres portaient ce
--     libellé avant le RUN, toutes renommées pendant).
\pset pager off
SHOW default_transaction_read_only;
WITH runs AS (
  SELECT id, "startedAt" debut, coalesce("finishedAt", now()) fin FROM "PipelineRun"
  WHERE command = 'ingest-all' AND "startedAt" >= now() - interval '7 days 3 hours'
), refus AS (
  SELECT DISTINCT ON (r.id, e."sourceKey", e.payload->'error'->>'externalId')
    r.id run_id, r.debut, r.fin, e.at, e."sourceKey" source, e.payload->'error'->>'externalId' ext,
    e.payload->'error'->>'rawEmployerName' raw, e.payload->'error'->>'proposedName' courant, e.payload->'error'->>'motif' motif
  FROM runs r JOIN "PipelineEvent" e ON e."runId" = r.id
  WHERE e.event = 'job.write_failed' AND e.payload->'error'->>'name' = 'EmployerIdentityReviewRequired'
    AND e.payload->'error'->>'motif' IN ('EMPLOYER_SPELLING_DIVERGED', 'EMPLOYER_TARGET_MISMATCH')
  ORDER BY r.id, e."sourceKey", e.payload->'error'->>'externalId', e.at
), lot AS (
  -- La capture de la source dans ce RUN : le dernier lot JOBS commencé avant le refus, dans la fenêtre du RUN.
  SELECT f.*, b.id batch_id, b."startedAt" debut_capture, (SELECT count(*) FROM "SourceExtraction" x WHERE x."batchId" = b.id) collectees
  FROM refus f
  LEFT JOIN LATERAL (SELECT cb.id, cb."startedAt" FROM "CaptureBatch" cb WHERE cb."sourceKey" = f.source AND cb.purpose = 'JOBS'
    AND cb."startedAt" BETWEEN f.debut AND f.at ORDER BY cb."startedAt" DESC LIMIT 1) b ON true
), jugement AS (
  SELECT l.*, prev."labelOrigin" origine_prec, prev."rawEmployerName" libelle_prec,
    prev."labelOrigin" IN ('SOURCE_CATALOGUE_LABEL', 'portal.certifiedScope:EMPLOYER_INFERRED_FROM_CERTIFIED_SINGLE_BRAND_PORTAL') prec_registre,
    t.temoins, t.employeur_temoins
  FROM lot l
  LEFT JOIN LATERAL (
    SELECT o."rawEmployerName", o."labelOrigin" FROM "EmployerObservation" o
    WHERE o."sourceKey" = l.source AND o."externalId" = l.ext AND o."canonicalEmployerId" IS NOT NULL AND o."observedAt" < l.at
    ORDER BY o."observedAt" DESC, o.id DESC LIMIT 1) prev ON true
  LEFT JOIN LATERAL (
    SELECT count(*) temoins, string_agg(DISTINCT c.name, ' ; ') employeur_temoins
    FROM "SourceExtraction" x
    JOIN LATERAL (SELECT o."normalizedEmployerName", o."canonicalEmployerId" FROM "EmployerObservation" o
      WHERE o."sourceKey" = l.source AND o."externalId" = x."externalId" AND o."observedAt" < l.debut_capture
      ORDER BY o."observedAt" DESC, o.id DESC LIMIT 1) last ON true
    LEFT JOIN LATERAL (SELECT o."normalizedEmployerName" FROM "EmployerObservation" o
      WHERE o."sourceKey" = l.source AND o."externalId" = x."externalId" AND o."observedAt" >= l.debut_capture AND o."observedAt" <= l.fin
      ORDER BY o."observedAt" DESC, o.id DESC LIMIT 1) pendant ON true
    JOIN "Company" c ON c.id = last."canonicalEmployerId"
    WHERE x."batchId" = l.batch_id AND x."externalId" <> l.ext
      AND last."normalizedEmployerName" = lower(btrim(regexp_replace(normalize(l.raw, NFKC), E'[[:space:]\\u00a0\\u202f]+', ' ', 'g')))
      AND coalesce(pendant."normalizedEmployerName", last."normalizedEmployerName") = last."normalizedEmployerName") t ON true
), decision AS (
  SELECT j.*, (NOT coalesce(j.prec_registre, true) AND j.employeur_temoins IS DISTINCT FROM j.courant) changement
  FROM jugement j
), garde AS (
  SELECT d.*, (d.changement AND coalesce(d.temoins, 0) > 0) suivable,
    count(*) FILTER (WHERE d.changement) OVER (PARTITION BY d.run_id, d.source) changements_source,
    greatest(5, 0.05 * d.collectees) borne
  FROM decision d
)
SELECT to_char(debut, 'MM-DD') run, source, motif, count(*) refus, max(collectees) collectees, max(borne) borne,
  count(*) FILTER (WHERE suivable) suivables,
  count(*) FILTER (WHERE suivable AND changements_source <= borne) suivies_sans_revue,
  count(*) FILTER (WHERE suivable AND changements_source > borne) garde_de_masse,
  count(*) FILTER (WHERE NOT suivable AND prec_registre) revue_precedent_registre,
  count(*) FILTER (WHERE NOT suivable AND NOT coalesce(prec_registre, true) AND coalesce(temoins, 0) = 0) revue_jamais_vu,
  count(*) FILTER (WHERE NOT suivable AND NOT coalesce(prec_registre, true) AND coalesce(temoins, 0) > 0) revue_meme_employeur,
  string_agg(DISTINCT raw || ' ← ' || coalesce(libelle_prec, '?') || ' (témoins ' || coalesce(temoins, 0) || ' : ' || coalesce(employeur_temoins, '-') || ')', ' ; ') exemple
FROM garde GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
