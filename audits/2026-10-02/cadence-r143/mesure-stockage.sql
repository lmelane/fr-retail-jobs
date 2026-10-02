-- R-143 §1 — ce qu'une collecte écrit dans la base, par source candidate à une passe légère. Production, LECTURE SEULE, hors RUN.
-- Rejouer : python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -F "|" -f audits/2026-10-02/cadence-r143/mesure-stockage.sql'
-- « Nouveaux octets » = corps (réponses brutes et sorties d'adaptateur) dont la ligne RawBlob a été créée pendant la
-- collecte : un corps identique à la collecte précédente est dédoublonné par son empreinte et ne coûte rien.

\echo S0 taille de la base et des tables qui grossissent à chaque collecte
SELECT pg_size_pretty(pg_database_size(current_database())) base;
SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) taille, c.reltuples::bigint lignes_estimees
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
WHERE c.relkind='r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 12;

\echo S1 par source candidate, collecte du dernier RUN : lignes écrites et nouveaux octets gzip conservés
WITH last AS (SELECT id FROM "PipelineRun" WHERE command='ingest-all' AND status <> 'RUNNING' ORDER BY "startedAt" DESC LIMIT 1),
b AS (SELECT cb.id, cb."sourceKey", cb."startedAt", o."completedAt" FROM "CaptureBatch" cb JOIN last ON last.id=cb."runId"
      JOIN "CaptureOutcome" o ON o."batchId"=cb.id WHERE cb.purpose='JOBS' AND cb."sourceKey" IN
      ('lvmh','ulta-jibe','rituals','lovisa','white-stuff','normal','foot-locker-france','la-casa-de-las-carcasas','lush',
       'space-nk','element-6','arcteryx','galeries-lafayette','hm-group','knitwell-us-retail','primark'))
SELECT b."sourceKey",
  (SELECT count(*) FROM "RawCapture" rc WHERE rc."batchId"=b.id) requetes,
  (SELECT count(*) FROM "SourceExtraction" x WHERE x."batchId"=b.id) sorties,
  (SELECT round(sum(r."gzipLength")/1048576.0,2) FROM "RawBlob" r WHERE r.hash IN (SELECT rc."blobHash" FROM "RawCapture" rc WHERE rc."batchId"=b.id)
     AND r."createdAt" BETWEEN b."startedAt" AND b."completedAt" + interval '1 hour') nouv_mio_gz_reponses,
  (SELECT count(*) FROM "RawBlob" r WHERE r.hash IN (SELECT x."outputHash" FROM "SourceExtraction" x WHERE x."batchId"=b.id)
     AND r."createdAt" BETWEEN b."startedAt" AND b."completedAt" + interval '1 hour') sorties_nouvelles,
  (SELECT round(sum(r."gzipLength")/1048576.0,2) FROM "RawBlob" r WHERE r.hash IN (SELECT x."outputHash" FROM "SourceExtraction" x WHERE x."batchId"=b.id)
     AND r."createdAt" BETWEEN b."startedAt" AND b."completedAt" + interval '1 hour') nouv_mio_gz_sorties
FROM b ORDER BY 1;
