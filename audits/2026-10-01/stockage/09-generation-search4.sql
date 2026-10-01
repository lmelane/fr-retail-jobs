-- STOCKAGE — 9. Ce que pèse la génération de recherche non servie (search-4) : documents et file d'attente.
-- Lecture seule. Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-01/stockage/09-generation-search4.sql'
-- La génération servie est une constante de l'API (apps/api/lib/search-index.ts : SEARCH_VERSION = search-5-…).
\pset footer off
\timing on
SELECT version, "readyAt" FROM "SearchGeneration" ORDER BY 1;
SELECT version, count(*) AS en_attente, min("queuedAt")::timestamp(0) AS plus_ancienne FROM "SearchPending" GROUP BY 1 ORDER BY 1;
\echo '== Part de chaque génération dans la charge vivante de SearchDocument (10 % des blocs, × 10)'
SELECT version, count(*) * 10 AS documents_estimes,
       round(sum(coalesce(pg_column_size(document), 0) + coalesce(pg_column_size(vector), 0)) * 10 / 1e9, 2) AS go_charge_vivante,
       round(sum(coalesce(pg_column_size(document), 0) + coalesce(pg_column_size(vector), 0)) * 10 / 1e9
             / (SELECT sum(coalesce(pg_column_size(document), 0) + coalesce(pg_column_size(vector), 0)) * 10 / 1e9
                FROM "SearchDocument" TABLESAMPLE SYSTEM (10) REPEATABLE (1)) * pg_total_relation_size('"SearchDocument"') / 1e9, 2)
         AS go_de_la_table_au_prorata
FROM "SearchDocument" TABLESAMPLE SYSTEM (10) REPEATABLE (1) GROUP BY 1 ORDER BY 1;
