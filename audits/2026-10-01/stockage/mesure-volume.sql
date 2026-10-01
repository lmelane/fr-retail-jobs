-- Mesure en lecture seule du stockage de la base de production (01/10/2026). Catalogue Postgres uniquement.
\pset footer off
SELECT pg_size_pretty(pg_database_size(current_database())) AS base_totale;
SELECT n.nspname||'.'||c.relname AS table,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_size_pretty(pg_relation_size(c.oid)) AS donnees,
       pg_size_pretty(pg_indexes_size(c.oid)) AS index,
       pg_size_pretty(pg_total_relation_size(c.oid)-pg_relation_size(c.oid)-pg_indexes_size(c.oid)) AS toast,
       c.reltuples::bigint AS lignes_estimees
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='r' AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 25;
SELECT relname, n_live_tup, n_dead_tup, round(100.0*n_dead_tup/greatest(n_live_tup+n_dead_tup,1),1) AS pct_mort,
       last_autovacuum, last_vacuum
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 10;
SELECT pg_size_pretty(sum(size)) AS wal FROM pg_ls_waldir();
SELECT version AS generation, count(*) AS documents FROM "SearchDocument" GROUP BY 1 ORDER BY 1;
