-- Libellés natifs d'employeur observés par source (lecture seule) : rejouer avec
--   CATWALKS_DB_ACCESS=… python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f <ce fichier>'
SELECT o."sourceKey", o."rawEmployerName", string_agg(DISTINCT split_part(o."labelOrigin", ':', 1), ',') AS origines,
       count(DISTINCT o."externalId") AS offres
FROM "EmployerObservation" o
WHERE o."sourceKey" IN ('vf-corporation','nike-nke2','mango','swarovski','canada-goose','puma','nike','mecca','aritzia',
  'uniqlo-hkm-headquarters','nordstrom','jansport','brunello-cucinelli','movado','therealreal','uniqlo-stores','tapestry','levis')
GROUP BY 1, 2 ORDER BY 1, offres DESC;
