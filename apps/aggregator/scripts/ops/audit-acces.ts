/**
 * L'ACCÈS D'AUDIT — vérifié par LECTURE des privilèges effectifs, avant toute mesure.
 *
 * ── POURQUOI CE MODULE, ET POURQUOI IL EST PARTAGÉ ─────────────────────────────────────────────
 *
 * Un script d'export qui porte son propre garde peut être lancé sans lui. Ici, `ouvrirAccesAudit`
 * est la SEULE façon d'obtenir un client : le contrôle est dans le chemin d'ouverture, pas à côté.
 * Un appelant qui l'ignore n'a pas de connexion du tout.
 *
 * ── CE QU'UN CONTRÔLE PAR LE NOM NE PROUVE PAS ─────────────────────────────────────────────────
 *
 * La version précédente refusait le nom « postgres » et s'arrêtait là. Ça ne prouvait rien :
 * n'importe quel autre compte peut être superutilisateur, hériter d'un rôle inscriptible, écrire
 * via un privilège accordé à `PUBLIC`, ou exécuter une fonction `SECURITY DEFINER` qui écrit avec
 * les droits de son propriétaire. Le nom d'un compte n'est pas un privilège.
 *
 * Les huit contrôles ci-dessous lisent les privilèges EFFECTIFS (`has_table_privilege` tient
 * compte de l'héritage). Aucun n'écrit : une écriture « de vérification » reste une écriture, et
 * c'est ainsi que des tables temporaires ont été créées en production le 2026-09-20.
 */
import { PrismaClient } from '@prisma/client';

export type Controle = { nom: string; ok: boolean; observe: string; attendu: string };
export type ProfilAudit = { role: string; base: string; controles: Controle[] };

/** Exécute les huit contrôles sur une connexion déjà ouverte. N'émet que des SELECT. */
export async function verifierPrivileges(prisma: PrismaClient): Promise<ProfilAudit> {
  const q = <T,>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
  const controles: Controle[] = [];
  const noter = (nom: string, ok: boolean, observe: string, attendu: string) =>
    controles.push({ nom, ok, observe, attendu });

  const [id] = await q<{ role: string; base: string; rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolbypassrls: boolean }>(
    `SELECT current_user AS role, current_database() AS base, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`);
  noter('C1 attributs du rôle', !id.rolsuper && !id.rolcreatedb && !id.rolcreaterole && !id.rolbypassrls,
    `super=${id.rolsuper} createdb=${id.rolcreatedb} createrole=${id.rolcreaterole} bypassrls=${id.rolbypassrls}`,
    'tous false');

  const [ecriture] = await q<{ n: bigint }>(
    `SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname = 'public'
        AND (has_table_privilege(current_user, c.oid, 'INSERT')
          OR has_table_privilege(current_user, c.oid, 'UPDATE')
          OR has_table_privilege(current_user, c.oid, 'DELETE')
          OR has_table_privilege(current_user, c.oid, 'TRUNCATE'))`);
  noter('C2 tables inscriptibles', Number(ecriture.n) === 0, String(ecriture.n), '0');

  const [lecture] = await q<{ lisibles: bigint; total: bigint }>(
    `SELECT count(*) FILTER (WHERE has_table_privilege(current_user, c.oid, 'SELECT')) AS lisibles,
            count(*) AS total
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname = 'public'`);
  noter('C3 couverture de lecture', lecture.lisibles === lecture.total,
    `${lecture.lisibles}/${lecture.total}`, 'lisibles = total');

  /*
   * C4 vérifie les TROIS paramètres, pas seulement le premier.
   *
   * La version précédente affichait les délais mais ne testait que `read_only` : un rôle sans
   * `statement_timeout` passait au vert alors qu'une requête d'audit pouvait tenir la base
   * indéfiniment. Un contrôle qui MONTRE une valeur sans la vérifier donne la même confiance
   * qu'un contrôle qui la vérifie — c'est pire que de ne pas l'afficher.
   *
   * Les délais sont lus en millisecondes (`setting` de `pg_settings`), parce que
   * `current_setting` rend une forme abrégée variable (« 1min », « 60s ») impossible à comparer.
   */
  const [params] = await q<{ ro: string; st: string; it: string; stMs: string; itMs: string }>(
    `SELECT current_setting('default_transaction_read_only') AS ro,
            current_setting('statement_timeout') AS st,
            current_setting('idle_in_transaction_session_timeout') AS it,
            (SELECT setting FROM pg_settings WHERE name = 'statement_timeout') AS "stMs",
            (SELECT setting FROM pg_settings WHERE name = 'idle_in_transaction_session_timeout') AS "itMs"`);
  const statementMs = Number(params.stMs);
  const idleMs = Number(params.itMs);
  const delaisPoses = statementMs > 0 && idleMs > 0;
  noter('C4 lecture seule et délais', params.ro === 'on' && delaisPoses,
    `read_only=${params.ro} statement=${params.st} idle=${params.it}`,
    'read_only = on, et les deux délais posés (non nuls)');

  const [creation] = await q<{ base: boolean; sch: boolean; tmp: boolean }>(
    `SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS base,
            has_schema_privilege(current_user, 'public', 'CREATE') AS sch,
            has_database_privilege(current_user, current_database(), 'TEMPORARY') AS tmp`);
  noter('C5 droits de création', !creation.base && !creation.sch && !creation.tmp,
    `base=${creation.base} schema=${creation.sch} temporaire=${creation.tmp}`, 'tous false');

  const publics = await q<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname = 'public'
        AND EXISTS (SELECT 1 FROM aclexplode(c.relacl) a
                     WHERE a.grantee = 0 AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE'))`);
  noter('C6 écriture via PUBLIC', publics.length === 0,
    publics.length ? `${publics.length} table(s)` : 'aucune', 'aucune');

  const definers = await q<{ proname: string; proprietaire: string }>(
    `SELECT p.proname, pg_get_userbyid(p.proowner) AS proprietaire
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND has_function_privilege(current_user, p.oid, 'EXECUTE')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')`);
  noter('C7 fonctions SECURITY DEFINER', definers.length === 0,
    definers.length ? `${definers.length} : ${definers.slice(0, 3).map(d => d.proname).join(', ')}` : 'aucune',
    'aucune');

  const herites = await q<{ role_herite: string }>(
    `SELECT r.rolname AS role_herite FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
      WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)`);
  noter('C8 rôles hérités', herites.length === 0,
    herites.length ? herites.map(h => h.role_herite).join(', ') : 'aucun', 'aucun');

  return { role: id.role, base: id.base, controles };
}

/**
 * Ouvre l'accès d'audit, ou ÉCHOUE. Il n'y a pas de troisième issue.
 *
 * Aucun repli : ce module ne lit que `AUDIT_DATABASE_URL` et ne connaît pas le chemin du fichier
 * d'accès administrateur. Le repli sur `postgres` est impossible par construction, pas par
 * discipline.
 */
export async function ouvrirAccesAudit(): Promise<{ prisma: PrismaClient; profil: ProfilAudit }> {
  const url = process.env.AUDIT_DATABASE_URL;
  if (!url) {
    throw new Error(
      'AUDIT_DATABASE_URL absente. Ce module ne lit que cette variable et ne se rabat sur aucun ' +
      'autre accès. Voir docs/audit-lot0/L1-PROCEDURE-ACCES-AUDIT.md §2.',
    );
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  let profil: ProfilAudit;
  try {
    profil = await verifierPrivileges(prisma);
  } catch (e) {
    // Une vérification qui ÉCHOUE ne prouve rien : on ferme et on remonte, jamais de repli permissif.
    await prisma.$disconnect().catch(() => {});
    throw new Error(`Impossible de vérifier les privilèges de l'accès : ${String(e)}`);
  }

  const echecs = profil.controles.filter((c) => !c.ok);
  if (echecs.length) {
    await prisma.$disconnect().catch(() => {});
    throw new Error(
      `${echecs.length} contrôle(s) d'accès en échec — aucune mesure ne doit démarrer :\n` +
      echecs.map((c) => `  ✗ ${c.nom} : ${c.observe} (attendu : ${c.attendu})`).join('\n') +
      '\nNe pas contourner, ne pas se rabattre sur `postgres` : remonter le résultat exact.',
    );
  }
  return { prisma, profil };
}
