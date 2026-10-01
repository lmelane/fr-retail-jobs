-- D-506 §3, mesure en lecture seule : les refus d'identité « changement d'employeur » des RUN ingest-all sur 7 jours,
-- avec ce que l'offre portait avant (dernière observation attribuée) et ce que l'éditeur déclare désormais.
-- Usage : python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f <ce fichier>'
\pset pager off
WITH runs AS (
  SELECT id, "startedAt", coalesce("finishedAt", now()) fin FROM "PipelineRun"
  WHERE command='ingest-all' AND "startedAt" >= now() - interval '7 days 3 hours'
), refus AS (
  SELECT DISTINCT ON (r.id, e."sourceKey", e.payload->'error'->>'externalId')
    r.id run_id, r."startedAt" debut, e.at, e."sourceKey" source, e.payload->'error'->>'externalId' ext,
    e.payload->'error'->>'rawEmployerName' raw, e.payload->'error'->>'proposedName' courant, e.payload->'error'->>'motif' motif
  FROM runs r JOIN "PipelineEvent" e ON e."runId"=r.id
  WHERE e.event='job.write_failed' AND e.payload->'error'->>'name'='EmployerIdentityReviewRequired'
    AND e.payload->'error'->>'motif' IN ('EMPLOYER_SPELLING_DIVERGED','EMPLOYER_TARGET_MISMATCH')
  ORDER BY r.id, e."sourceKey", e.payload->'error'->>'externalId', e.at
)
SELECT to_char(f.debut,'MM-DD') run, f.source, f.motif, f.ext, f.raw AS "libellé déclaré", f.courant AS "employeur courant",
  prev."rawEmployerName" AS "libellé précédent", prev."labelOrigin" AS "origine précédente"
FROM refus f
LEFT JOIN LATERAL (
  SELECT o."rawEmployerName", o."labelOrigin" FROM "EmployerObservation" o
  WHERE o."sourceKey"=f.source AND o."externalId"=f.ext AND o."canonicalEmployerId" IS NOT NULL AND o."observedAt" < f.at
  ORDER BY o."observedAt" DESC, o.id DESC LIMIT 1) prev ON true
ORDER BY 1, 2, 4;
