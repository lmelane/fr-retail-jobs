/**
 * INVENTAIRE DU SCHÉMA (lot F1) — objet par objet, lu sur une base réelle et croisé avec le code.
 *
 * Pour chaque table : lignes, octets ; pour chaque colonne : type, nullable, taux de nuls et de valeurs
 * distinctes et largeur moyenne (statistiques du planificateur, `pg_stats`) ; index (taille, unicité) ; contraintes ; déclencheurs ;
 * fonctions. Puis, pour chaque colonne, le nombre de fichiers qui nomment l'identifiant, par classe :
 * runtime (src, lib, app, packages), scripts, témoins, migrations SQL, docs. Un nom générique (id, status,
 * title…) est marqué « inconclusif » : le comptage ne distingue pas les tables.
 *
 * Lecture seule (`default_transaction_read_only`). Sortie : un JSON complet et un résumé.
 * Usage : DATABASE_URL=<base> npx tsx audits/reprise-2026-09-15/scripts/schema-inventaire.mts <sortie.json> [stats-prod.json]
 */
import { prisma } from '@catwalks/db';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const q = <T = any>(s: string) => prisma.$queryRawUnsafe<T[]>(s);
const num = (o: any) => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));

function fichiers(dossier: string, out: string[] = []): string[] {
  const abs = path.join(RACINE, dossier);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    if (['node_modules', '.next', 'dist', '__pycache__', 'backups', 'fixtures', '__fixtures__'].includes(e.name)) continue;
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) fichiers(p, out);
    else if (/\.(ts|tsx|mts|mjs|js|py|sh|sql|md)$/.test(e.name) && statSync(path.join(RACINE, p)).size < 2_000_000) out.push(p);
  }
  return out;
}
const classe = (f: string) => {
  if (f.startsWith('packages/db/prisma/migrations/')) return 'migrations';
  if (f.startsWith('docs/') || f.endsWith('.md')) return 'docs';
  if (/\.test\.(ts|mts)$/.test(f) || f.includes('/__tests__/') || f.includes('/src/test/') || f.includes('/tests/')) return 'temoins';
  if (f.includes('/scripts/')) return 'scripts';
  if (f === 'packages/db/prisma/schema.prisma') return 'schema';
  return 'runtime';
};
const corpus = ['apps/aggregator/src', 'apps/aggregator/scripts', 'apps/api/lib', 'apps/api/app', 'apps/api/scripts', 'packages/db', 'docs', 'README.md', 'apps/aggregator/README.md']
  .flatMap((d) => (d.endsWith('.md') ? [d] : fichiers(d)))
  .map((f) => ({ f, classe: classe(f), texte: readFileSync(path.join(RACINE, f), 'utf8') }));
const GENERIQUES = new Set(['id', 'status', 'title', 'url', 'name', 'key', 'kind', 'type', 'value', 'data', 'config', 'source', 'city', 'country', 'description', 'language', 'createdAt', 'updatedAt', 'version', 'hash', 'reason', 'code', 'label', 'field', 'before', 'after', 'at', 'ok', 'errors', 'total', 'page', 'body', 'content', 'raw', 'note', 'method', 'path', 'origin', 'sequence', 'verdict', 'detail', 'report']);

(async () => {
  const [cible] = await q<{ base: string }>(`SELECT current_database() AS base`);
  const tables = num(await q(`SELECT c.relname AS table, c.reltuples::bigint AS lignes_estimees, pg_total_relation_size(c.oid)::bigint AS octets, pg_relation_size(c.oid)::bigint AS octets_table
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 3 DESC`));
  const colonnes = num(await q(`SELECT table_name AS table, column_name AS colonne, data_type AS type, is_nullable = 'YES' AS nullable, column_default AS defaut, ordinal_position AS position
    FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`));
  const index = num(await q(`SELECT tablename AS table, indexname AS index, indexdef AS definition, pg_relation_size((quote_ident(schemaname)||'.'||quote_ident(indexname))::regclass)::bigint AS octets FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`));
  const contraintes = num(await q(`SELECT conrelid::regclass::text AS table, conname AS nom, contype AS type, pg_get_constraintdef(oid) AS definition, condeferrable AS differable FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`));
  const declencheurs = num(await q(`SELECT tgrelid::regclass::text AS table, tgname AS nom, pg_get_triggerdef(oid) AS definition, tgenabled AS actif FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1, 2`));
  const fonctions = num(await q(`SELECT p.proname AS nom, pg_get_function_identity_arguments(p.oid) AS arguments, l.lanname AS langage, length(p.prosrc) AS taille FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang WHERE n.nspname = 'public' ORDER BY 1`));
  const roles = num(await q(`SELECT rolname, rolconfig FROM pg_roles WHERE rolconfig IS NOT NULL`));
  // Lignes exactes par table, statistiques du planificateur par colonne (taux de nuls, distinctes, largeur) :
  // instantanées, et suffisantes pour classer ; un comptage exact de DISTINCT sur 80 colonnes de « Job »
  // (tsvector et textes compris) a fait tomber le conteneur de 2 Go du clone le 16/09.
  const lignesExactes: Record<string, number> = {};
  for (const t of tables) { const [r] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM "${t.table}"`); lignesExactes[t.table] = r.n; }
  const stats = num(await q(`SELECT tablename AS table, attname AS colonne, null_frac, n_distinct, avg_width FROM pg_stats WHERE schemaname = 'public'`));
  const nuls: Record<string, { tauxNuls: number | null; distinctes: number | null; largeur: number | null }> = {};
  for (const s of stats) nuls[`${s.table}.${s.colonne}`] = { tauxNuls: s.null_frac, distinctes: s.n_distinct, largeur: s.avg_width };
  const usages: Record<string, any> = {};
  for (const c of colonnes) {
    const nom = c.colonne; const cle = `${c.table}.${nom}`;
    const rx = new RegExp(`(?<![A-Za-z0-9_])${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`);
    const parClasse: Record<string, number> = {};
    for (const f of corpus) if (rx.test(f.texte)) parClasse[f.classe] = (parClasse[f.classe] ?? 0) + 1;
    usages[cle] = { ...parClasse, inconclusif: GENERIQUES.has(nom) };
  }
  const statsProd = process.argv[3] && existsSync(process.argv[3]) ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : null;
  const sortie = { luLe: new Date().toISOString(), base: cible.base, tables: tables.map((t: any) => ({ ...t, lignes: lignesExactes[t.table] })), colonnes: colonnes.map((c: any) => ({ ...c, ...nuls[`${c.table}.${c.colonne}`], usages: usages[`${c.table}.${c.colonne}`] })), index, contraintes, declencheurs, fonctions, roles, statsProd: statsProd ? { luLe: statsProd.luLe, index: statsProd.index, tables: statsProd.tables } : null };
  writeFileSync(process.argv[2], JSON.stringify(sortie, null, 1) + '\n');
  const sansUsage = sortie.colonnes.filter((c: any) => !c.usages.inconclusif && !c.usages.runtime && !c.usages.scripts);
  console.log(JSON.stringify({ base: cible.base, tables: tables.length, colonnes: colonnes.length, index: index.length, contraintes: contraintes.length, declencheurs: declencheurs.length, fonctions: fonctions.length, colonnesSansUsageRuntimeNiScripts: sansUsage.length }));
  for (const c of sansUsage) console.log(`  ${c.table}.${c.colonne} (${c.type}) lignes ${lignesExactes[c.table]} nuls ${c.tauxNuls ?? '?'} distinctes ${c.distinctes ?? '?'} | témoins ${c.usages.temoins ?? 0} migrations ${c.usages.migrations ?? 0} docs ${c.usages.docs ?? 0}`);
  await prisma.$disconnect();
})().catch((e) => { console.error('inventaire :', String(e.message).slice(0, 300)); process.exit(1); });
