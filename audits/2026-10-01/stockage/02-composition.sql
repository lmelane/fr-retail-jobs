-- STOCKAGE — 2. De quoi est fait chaque octet : taille STOCKÉE par colonne, sur échantillon de blocs.
-- Lecture seule. Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-01/stockage/02-composition.sql'
--
-- Méthode : TABLESAMPLE SYSTEM lit un pourcentage de BLOCS (pas de parcours complet). pg_column_size rend la taille
-- STOCKÉE d'une valeur (compressée, et pour une valeur sortie en TOAST, lue dans son pointeur sans la décompresser).
-- « vivant_estime » = moyenne de l'échantillon × lignes estimées du catalogue. L'écart entre la taille du fichier
-- (tas + TOAST) et ce vivant est l'espace mort : versions remplacées et place libre que seul VACUUM FULL rendrait.
-- On n'utilise JAMAIS pg_column_size(t.*) : construire la ligne entière décompresserait tout le TOAST.
\pset footer off
\timing on

\echo '== RawBlobBody : corps gzip. Taille stockée vs octets gzip déclarés (RawBlob.gzipLength) — 1 % des blocs'
SELECT count(*) AS echantillon,
       round(avg(pg_column_size(b.gzip))) AS moy_stocke,
       round(avg(r."gzipLength")) AS moy_gzip_declare,
       round(avg(r."byteLength")) AS moy_decompresse,
       round(avg(r."byteLength")::numeric / nullif(avg(r."gzipLength"), 0), 1) AS ratio_gzip
FROM "RawBlobBody" b TABLESAMPLE SYSTEM (1) JOIN "RawBlob" r ON r.hash = b.hash;

\echo '== RawBlob : somme exacte des octets gzip encore chauds (corps présent) et archivés (pointeur distant)'
\echo '   (RawBlob est un tas de 257 Mo sans TOAST ; le parcours est borné par le délai de 25 s de db.py readonly)'
SELECT count(*) AS blobs,
       (SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'RawBlobBody') AS corps_presents_stat,
       sum(r."gzipLength") AS gzip_octets,
       pg_size_pretty(sum(r."gzipLength")) AS gzip_total,
       pg_size_pretty(sum(r."byteLength")) AS decompresse_total,
       (SELECT count(*) FROM "RawBlobArchive") AS archives
FROM "RawBlob" r;

\echo '== Job : taille stockée par colonne lourde — 10 % des blocs'
SELECT count(*) AS echantillon,
       round(avg(pg_column_size(description))) AS description,
       round(avg(pg_column_size(raw))) AS raw,
       round(avg(pg_column_size("searchText"))) AS search_text,
       round(avg(pg_column_size("searchVector"))) AS search_vector,
       round(avg(pg_column_size("titleVector"))) AS title_vector,
       round(avg(pg_column_size("occupationEvidence"))) AS occupation_evidence,
       round(avg(pg_column_size("employmentEvidence"))) AS employment_evidence,
       round(avg(coalesce(pg_column_size(description),0) + coalesce(pg_column_size(raw),0) + coalesce(pg_column_size("searchText"),0)
         + coalesce(pg_column_size("searchVector"),0) + coalesce(pg_column_size("titleVector"),0)
         + coalesce(pg_column_size("occupationEvidence"),0) + coalesce(pg_column_size("employmentEvidence"),0))) AS lourdes_par_ligne,
       pg_size_pretty((avg(coalesce(pg_column_size(description),0) + coalesce(pg_column_size(raw),0) + coalesce(pg_column_size("searchText"),0)
         + coalesce(pg_column_size("searchVector"),0) + coalesce(pg_column_size("titleVector"),0)
         + coalesce(pg_column_size("occupationEvidence"),0) + coalesce(pg_column_size("employmentEvidence"),0))
         * (SELECT reltuples FROM pg_class WHERE relname = 'Job'))::bigint) AS lourdes_vivant_estime,
       pg_size_pretty(pg_table_size('"Job"')) AS tas_plus_toast_fichier
FROM "Job" TABLESAMPLE SYSTEM (10);

\echo '== JobSource : raw / presentation / sourceFacts / expiryEvidence — 10 % des blocs'
SELECT count(*) AS echantillon,
       round(avg(pg_column_size(raw))) AS raw,
       round(avg(pg_column_size(presentation))) AS presentation,
       round(avg(pg_column_size("sourceFacts"))) AS source_facts,
       round(avg(pg_column_size("expiryEvidence"))) AS expiry_evidence,
       pg_size_pretty((avg(coalesce(pg_column_size(raw),0) + coalesce(pg_column_size(presentation),0)
         + coalesce(pg_column_size("sourceFacts"),0) + coalesce(pg_column_size("expiryEvidence"),0))
         * (SELECT reltuples FROM pg_class WHERE relname = 'JobSource'))::bigint) AS lourdes_vivant_estime,
       pg_size_pretty(pg_table_size('"JobSource"')) AS tas_plus_toast_fichier
FROM "JobSource" TABLESAMPLE SYSTEM (10);

\echo '== SourceObservation : raw (sortie d adaptateur) — 5 % des blocs ; part déjà déplacée vers un blob'
SELECT count(*) AS echantillon,
       count(*) FILTER (WHERE raw IS NULL) AS raw_vide,
       count(*) FILTER (WHERE "rawBlobHash" IS NOT NULL) AS avec_pointeur_blob,
       count(*) FILTER (WHERE "captureBatchId" IS NOT NULL) AS avec_capture,
       round(avg(pg_column_size(raw))) AS raw_moy,
       pg_size_pretty((avg(coalesce(pg_column_size(raw),0)) * (SELECT reltuples FROM pg_class WHERE relname = 'SourceObservation'))::bigint) AS raw_vivant_estime,
       pg_size_pretty(pg_table_size('"SourceObservation"')) AS tas_plus_toast_fichier
FROM "SourceObservation" TABLESAMPLE SYSTEM (5);

\echo '== SearchDocument : par génération — 10 % des blocs'
SELECT version, count(*) AS echantillon,
       round(avg(pg_column_size(document))) AS document_moy,
       round(avg(pg_column_size(vector))) AS vector_moy
FROM "SearchDocument" TABLESAMPLE SYSTEM (10) GROUP BY 1 ORDER BY 1;
SELECT pg_size_pretty((avg(coalesce(pg_column_size(document),0) + coalesce(pg_column_size(vector),0))
         * (SELECT reltuples FROM pg_class WHERE relname = 'SearchDocument'))::bigint) AS vivant_estime,
       pg_size_pretty(pg_table_size('"SearchDocument"')) AS tas_plus_toast_fichier
FROM "SearchDocument" TABLESAMPLE SYSTEM (10);

\echo '== RawCapture : ce qui pèse dans une ligne de capture (pas de TOAST : tout est dans le tas) — 2 % des blocs'
SELECT count(*) AS echantillon,
       round(avg(pg_column_size(headers))) AS headers,
       round(avg(pg_column_size("requestUrl"))) AS request_url,
       round(avg(pg_column_size("cookieNames"))) AS cookie_names,
       round(avg(pg_column_size(failure))) AS failure,
       count(*) FILTER (WHERE "blobHash" IS NULL) AS sans_corps
FROM "RawCapture" TABLESAMPLE SYSTEM (2);

\echo '== OccupationObservation : decision / before — 10 % des blocs'
SELECT count(*) AS echantillon, round(avg(pg_column_size(decision))) AS decision, round(avg(pg_column_size(before))) AS before
FROM "OccupationObservation" TABLESAMPLE SYSTEM (10);
