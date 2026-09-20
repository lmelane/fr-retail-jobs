/**
 * L1 §3 — LES HUIT CONTRÔLES DE L'ACCÈS D'AUDIT, PAR LECTURE SEULE.
 *
 *   AUDIT_DATABASE_URL='postgresql://catwalks_audit:...' \
 *     npx tsx apps/aggregator/scripts/ops/audit-verifier-acces.mts
 *
 * ── CE QU'IL FAIT, ET CE QU'IL REFUSE DE FAIRE ─────────────────────────────────────────────────
 *
 * Il n'émet que des SELECT sur le catalogue système. Aucune tentative d'écriture : une écriture
 * « de vérification » est une écriture, et c'est ainsi que des tables temporaires ont été créées
 * en production le 2026-09-20.
 *
 * Il lit UNIQUEMENT `AUDIT_DATABASE_URL`. Il n'ouvre jamais `DATABASE_URL`, jamais le fichier
 * d'accès administrateur : **aucun repli sur `postgres` n'est possible, même par erreur**, parce
 * que le script ne connaît pas ce chemin.
 *
 * Les huit contrôles couvrent les vecteurs qu'une lecture naïve des GRANT nominatifs manque :
 * héritage de rôles (C8), droits accordés à PUBLIC (C6), fonctions SECURITY DEFINER exécutables
 * (C7) et privilège TEMPORARY sur la base (C5).
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.AUDIT_DATABASE_URL;
if (!url) {
  console.error(
    'AUDIT_DATABASE_URL absente.\n' +
    'Ce script ne lit QUE cette variable : il ne se rabat sur aucun autre accès, par construction.\n' +
    'Voir docs/audit-lot0/L1-PROCEDURE-ACCES-AUDIT.md §2 pour le provisionnement.',
  );
  process.exit(2);
}
if (/(^|:\/\/)postgres:/.test(url)) {
  console.error('GARDE-FOU : AUDIT_DATABASE_URL porte le rôle `postgres`. Le compte d\'audit est exigé.');
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });
const q = <T,>(sql: string, ...p: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...p);

type Controle = { nom: string; verdict: 'OK' | 'ECHEC'; observe: string; attendu: string };
const resultats: Controle[] = [];
const noter = (nom: string, ok: boolean, observe: string, attendu: string) =>
  resultats.push({ nom, verdict: ok ? 'OK' : 'ECHEC', observe, attendu });

// C1 — identité et attributs du rôle.
const [c1] = await q<{ current_user: string; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolbypassrls: boolean }>(
  `SELECT current_user, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
     FROM pg_roles WHERE rolname = current_user`);
noter('C1 attributs du rôle',
  !c1.rolsuper && !c1.rolcreatedb && !c1.rolcreaterole && !c1.rolbypassrls,
  `${c1.current_user} · super=${c1.rolsuper} createdb=${c1.rolcreatedb} createrole=${c1.rolcreaterole} bypassrls=${c1.rolbypassrls}`,
  'tous false');

// C2 — privilèges d'écriture EFFECTIFS (héritage compris).
const [c2] = await q<{ n: bigint }>(
  `SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname = 'public'
      AND (has_table_privilege(current_user, c.oid, 'INSERT')
        OR has_table_privilege(current_user, c.oid, 'UPDATE')
        OR has_table_privilege(current_user, c.oid, 'DELETE')
        OR has_table_privilege(current_user, c.oid, 'TRUNCATE'))`);
noter('C2 tables inscriptibles', Number(c2.n) === 0, `${c2.n}`, '0');

// C3 — couverture de lecture : une table illisible rend une mesure muette, sans erreur.
const [c3] = await q<{ lisibles: bigint; total: bigint }>(
  `SELECT count(*) FILTER (WHERE has_table_privilege(current_user, c.oid, 'SELECT')) AS lisibles,
          count(*) AS total
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname = 'public'`);
noter('C3 couverture de lecture', c3.lisibles === c3.total, `${c3.lisibles}/${c3.total}`, 'lisibles = total');

// C4 — paramètres effectifs de session.
const [c4] = await q<{ ro: string; st: string; it: string }>(
  `SELECT current_setting('default_transaction_read_only') AS ro,
          current_setting('statement_timeout') AS st,
          current_setting('idle_in_transaction_session_timeout') AS it`);
noter('C4 paramètres de session', c4.ro === 'on', `read_only=${c4.ro} statement=${c4.st} idle=${c4.it}`,
  'read_only = on');

// C5 — création de base, de schéma, et TABLES TEMPORAIRES.
const [c5] = await q<{ base: boolean; schema: boolean; temporaire: boolean }>(
  `SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS base,
          has_schema_privilege(current_user, 'public', 'CREATE') AS schema,
          has_database_privilege(current_user, current_database(), 'TEMPORARY') AS temporaire`);
noter('C5 droits de création', !c5.base && !c5.schema && !c5.temporaire,
  `base=${c5.base} schema=${c5.schema} temporaire=${c5.temporaire}`, 'tous false');

// C6 — droits d'écriture accordés à PUBLIC, donc hérités sans aucun GRANT nominatif.
const c6 = await q<{ relname: string }>(
  `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname = 'public'
      AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a
                   WHERE a.grantee = 0 AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE'))`);
noter('C6 écriture via PUBLIC', c6.length === 0,
  c6.length ? `${c6.length} table(s) : ${c6.slice(0, 5).map(r => r.relname).join(', ')}` : 'aucune', 'aucune ligne');

// C7 — fonctions SECURITY DEFINER exécutables : elles tournent avec les droits de leur propriétaire.
const c7 = await q<{ proname: string; proprietaire: string }>(
  `SELECT p.proname, pg_get_userbyid(p.proowner) AS proprietaire
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND has_function_privilege(current_user, p.oid, 'EXECUTE')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')`);
noter('C7 fonctions SECURITY DEFINER', c7.length === 0,
  c7.length ? `${c7.length} : ${c7.slice(0, 5).map(r => `${r.proname} (${r.proprietaire})`).join(', ')}` : 'aucune',
  'aucune ligne');

// C8 — appartenance à d'autres rôles.
const c8 = await q<{ role_herite: string }>(
  `SELECT r.rolname AS role_herite FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
    WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)`);
noter('C8 rôles hérités', c8.length === 0,
  c8.length ? c8.map(r => r.role_herite).join(', ') : 'aucun', 'aucune ligne');

await prisma.$disconnect();

console.log('\n═══ L1 §3 — CONTRÔLES DE L\'ACCÈS D\'AUDIT ═══\n');
for (const r of resultats)
  console.log(`  ${r.verdict === 'OK' ? '✓' : '✗'} ${r.nom.padEnd(32)} ${r.observe.padEnd(44)} (attendu : ${r.attendu})`);

const echecs = resultats.filter(r => r.verdict === 'ECHEC');
if (echecs.length) {
  console.log(`\n✗ ${echecs.length} CONTRÔLE(S) EN ÉCHEC — aucune mesure ne doit démarrer.`);
  console.log('  Ne pas contourner, ne pas se rabattre sur `postgres` : remonter le résultat exact.');
  process.exit(1);
}
console.log('\n✓ Les huit contrôles passent. L\'accès est utilisable pour les mesures.\n');
