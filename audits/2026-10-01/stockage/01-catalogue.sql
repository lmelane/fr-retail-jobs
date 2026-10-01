-- STOCKAGE — 1. Ce qui occupe le volume, lu dans le CATALOGUE seulement (aucun parcours de table).
-- Lecture seule. Rejouable :
--   python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -f audits/2026-10-01/stockage/01-catalogue.sql'
-- Toutes les tailles sont en octets ET en clair : un chiffre arrondi par pg_size_pretty ne se re-somme pas.
\pset footer off
\timing off

\echo '== Bases du serveur (le volume Railway porte TOUTES les bases, pas seulement celle-ci)'
SELECT datname, pg_database_size(datname) AS octets, pg_size_pretty(pg_database_size(datname)) AS taille
FROM pg_database ORDER BY 2 DESC;

\echo '== Espaces de tables'
SELECT spcname, pg_size_pretty(pg_tablespace_size(oid)) AS taille FROM pg_tablespace;

\echo '== Par table : tas, TOAST (table + index du TOAST), index, cartes FSM/VM'
WITH t AS (
  SELECT c.oid, c.relname, c.reltuples::bigint AS lignes_estimees,
         pg_total_relation_size(c.oid) AS total,
         pg_relation_size(c.oid, 'main') AS tas,
         pg_relation_size(c.oid, 'fsm') + pg_relation_size(c.oid, 'vm') AS cartes,
         coalesce(pg_total_relation_size(nullif(c.reltoastrelid, 0)), 0) AS toast,
         pg_indexes_size(c.oid) AS index
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'm') AND n.nspname = 'public')
SELECT relname AS table, total, pg_size_pretty(total) AS total_lisible,
       pg_size_pretty(tas) AS tas, pg_size_pretty(toast) AS toast, pg_size_pretty(index) AS index,
       pg_size_pretty(cartes) AS fsm_vm, lignes_estimees,
       CASE WHEN lignes_estimees > 0 THEN (total / lignes_estimees) END AS octets_par_ligne,
       round(100.0 * total / sum(total) OVER (), 1) AS pct_base
FROM t ORDER BY total DESC LIMIT 30;

\echo '== Somme des tables publiques vs taille de la base (le reste = catalogue système)'
SELECT pg_size_pretty(sum(pg_total_relation_size(c.oid))) AS tables_publiques,
       pg_size_pretty(pg_database_size(current_database())) AS base
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','m') AND n.nspname = 'public';

\echo '== Index les plus lourds (taille, nombre de parcours depuis la remise à zéro des statistiques)'
SELECT s.relname AS table, s.indexrelname AS index, pg_relation_size(s.indexrelid) AS octets,
       pg_size_pretty(pg_relation_size(s.indexrelid)) AS taille, s.idx_scan AS parcours
FROM pg_stat_user_indexes s ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 30;

\echo '== Activité depuis la remise à zéro des statistiques : insertions, mises à jour, suppressions, tuples morts'
SELECT relname, n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / greatest(n_live_tup + n_dead_tup, 1), 1) AS pct_mort,
       n_tup_ins, n_tup_upd, n_tup_hot_upd, n_tup_del,
       last_autovacuum::timestamp(0), last_autoanalyze::timestamp(0), autovacuum_count
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 20;

\echo '== Date de remise à zéro des statistiques (le dénominateur des compteurs ci-dessus)'
SELECT datname, stats_reset::timestamp(0), temp_files, pg_size_pretty(temp_bytes) AS temp_cumule
FROM pg_stat_database WHERE datname = current_database();

\echo '== WAL : volume présent, réglages qui le bornent, slots qui pourraient le retenir'
SELECT count(*) AS segments, pg_size_pretty(sum(size)) AS wal FROM pg_ls_waldir();
SELECT name, setting, unit FROM pg_settings
WHERE name IN ('max_wal_size','min_wal_size','wal_keep_size','max_slot_wal_keep_size','archive_mode',
               'wal_level','checkpoint_timeout','wal_compression','autovacuum','autovacuum_vacuum_scale_factor',
               'autovacuum_vacuum_cost_limit','default_toast_compression','logging_collector','log_directory',
               'shared_buffers','work_mem','maintenance_work_mem')
ORDER BY name;
SELECT slot_name, slot_type, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS wal_retenu
FROM pg_replication_slots;
SELECT count(*) AS slots FROM pg_replication_slots;

\echo '== Générations de la projection de recherche (catalogue seulement : compte par l index)'
SELECT version, count(*) AS documents FROM "SearchDocument" GROUP BY 1 ORDER BY 1;
