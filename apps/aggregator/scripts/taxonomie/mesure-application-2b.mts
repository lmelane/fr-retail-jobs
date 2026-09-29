/**
 * Lot 2B de D-475 : mesures EN LECTURE SEULE sur la production avant d'appliquer les migrations additives
 * (20260929160000_occupation_title_roles_domain, 20260929160100_occupation_learned_table) : tailles de Job et
 * DirectOffer (durée des index et contraintes sous verrou), versions de la taxonomie présentes (la migration indexe
 * leurs clés : une clé en double ferait échouer la migration), version active et migrations déjà appliquées.
 * Accès et garde : ceux des exports (rôle `catwalks_audit`, identifiants hors dépôt jamais affichés, transaction
 * `READ ONLY` vérifiée AVANT toute lecture).
 *
 *   node --import tsx apps/aggregator/scripts/taxonomie/mesure-application-2b.mts
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const refus = (motif: string): never => { console.error(`REFUS : ${motif}`); process.exit(3); };
const BASE = 'railway';
const fichier = process.env.CATWALKS_AUDIT_FILE ?? `${homedir()}/.catwalks/audit-access.json`;
let acces: Record<string, unknown> = {};
try { acces = JSON.parse(readFileSync(fichier, 'utf8')); } catch { refus('fichier d’accès absent ou invalide'); }
if (acces.PGDATABASE !== BASE) refus(`base ${BASE} attendue`);
if (acces.PGUSER !== 'catwalks_audit') refus('la production ne se lit qu’avec catwalks_audit');

const script = `
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT (current_database() = '${BASE}' AND current_user = 'catwalks_audit' AND current_setting('transaction_read_only') = 'on'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS garde_ok \\gset
\\if :garde_ok
SELECT json_build_object(
  'tables', (SELECT json_object_agg(t, json_build_object('lignes', (SELECT reltuples::bigint FROM pg_class WHERE oid = t::regclass),
     'table_Mo', round(pg_relation_size(t::regclass) / 1048576.0), 'total_Mo', round(pg_total_relation_size(t::regclass) / 1048576.0)))
     FROM unnest(ARRAY['"Job"', '"DirectOffer"', '"OccupationRelease"']) t),
  'versions', (SELECT json_agg(json_build_object('id', id, 'Ko', octet_length(manifest::text) / 1024,
     'doublons', (SELECT count(*) - count(DISTINCT x->>'key') FROM jsonb_array_elements(manifest->'occupations') x)
               + (SELECT count(*) - count(DISTINCT x->>'key') FROM jsonb_array_elements(manifest->'families') x)
               + (SELECT count(*) - count(DISTINCT x->>'key') FROM jsonb_array_elements(manifest->'groups') x),
     'famillesSansDomaine', (SELECT count(*) FROM jsonb_array_elements(manifest->'families') x WHERE x->>'group' IS NULL)) ORDER BY "createdAt")
     FROM "OccupationRelease"),
  'active', (SELECT "releaseId" FROM "OccupationState" WHERE id = 'active'),
  'dernieresMigrations', (SELECT json_agg(migration_name ORDER BY finished_at DESC) FROM (SELECT migration_name, finished_at FROM _prisma_migrations
     WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 4) m),
  'migrations2bPresentes', (SELECT count(*) FROM _prisma_migrations WHERE migration_name LIKE '20260929160%'),
  'connexionsActives', (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active'));
\\else
SELECT 'REFUS';
\\endif
ROLLBACK;
`;
const { PATH, HOME, LANG } = process.env;
const run = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  input: script, maxBuffer: 64 * 1024 * 1024,
  env: { PATH, HOME, LANG, PGHOST: String(acces.PGHOST), PGPORT: String(acces.PGPORT), PGUSER: String(acces.PGUSER),
    PGPASSWORD: String(acces.PGPASSWORD), PGDATABASE: BASE, PGSSLMODE: 'require',
    PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15', PGAPPNAME: 'mesure-application-2b' },
  encoding: 'utf8',
});
if (run.status !== 0) refus(`psql : ${run.stderr.split('\n')[0]}`);
const sortie = run.stdout.trim();
if (sortie === 'REFUS' || !sortie.startsWith('{')) refus('garde de lecture seule non vérifiée');
console.log(JSON.stringify(JSON.parse(sortie), null, 1));
