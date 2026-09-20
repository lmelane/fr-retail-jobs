/**
 * ACCÈS D'AUDIT — contrôle par LECTURE des privilèges réels, jamais par tentative d'écriture.
 *
 * ── CE QUI A ÉTÉ ÉTABLI, ET QUI MOTIVE CE FICHIER ──────────────────────────────────────────────
 *
 * 1. `db.py readonly` pose `PGOPTIONS`, une variable lue par `libpq` (donc `psql`). Le moteur de
 *    Prisma est en Rust, ouvre ses connexions lui-même et ne la lit jamais. Mesuré le 2026-09-20 :
 *    sous `db.py readonly`, `CREATE TEMP TABLE` a RÉUSSI sur la production. 143 scripts d'audit
 *    passent par Prisma : pour eux la garantie annoncée n'existait pas.
 *
 * 2. Le correctif par `SET` de session ne tient pas : Prisma gère un POOL, et le `SET` ne
 *    verrouille que la connexion qui l'a reçu. Mesuré sur 8 requêtes concurrentes : 1 connexion
 *    verrouillée, 7 ouvertes en écriture.
 *
 * 3. Le paramètre porté par l'URL s'applique bien à chaque connexion du pool — MAIS
 *    `default_transaction_read_only` est un RÉGLAGE PAR DÉFAUT, pas un privilège : toute session
 *    peut le remettre à `off`, et un SUPERUTILISATEUR n'est de toute façon contraint par aucun
 *    GRANT. Or le seul accès production configuré (`backups/remediation-20260908/postgres-access.json`)
 *    est le rôle `postgres`, superutilisateur. Un réglage par défaut sur un superutilisateur n'est
 *    pas une protection : c'est une convention.
 *
 * ── CE QUE FAIT CE MODULE, ET CE QU'IL REFUSE DE FAIRE ─────────────────────────────────────────
 *
 * Il ne tente AUCUNE écriture. Une tentative d'écriture au démarrage d'un script de production est
 * elle-même une écriture — des `CREATE TEMP TABLE` ont réussi en production à cause de cette
 * approche. Et un `catch` nu autour d'une telle tentative confond l'ÉCHEC DE LA PREUVE avec LA
 * PREUVE : une coupure réseau, un `statement_timeout` expiré ou une erreur de syntaxe y devenaient
 * une « garantie de lecture seule ».
 *
 * Le contrôle est donc fait par LECTURES du catalogue : identité, attribut superutilisateur,
 * privilèges effectifs d'écriture sur les tables du schéma, et paramètres de session effectifs.
 * Chaque exception remonte : rien n'est interprété comme un succès par défaut.
 */
import { PrismaClient } from '@prisma/client';

/** Le paramètre serveur, encodé pour une URL PostgreSQL (`=` doit être `%3D` dans `options`). */
const OPTIONS_LECTURE_SEULE = '-c default_transaction_read_only%3Don';

/** Ce qu'une inspection de l'accès établit, par lecture seule. */
export type ProfilAcces = {
  role: string;
  base: string;
  superutilisateur: boolean;
  /** Tables du schéma public sur lesquelles le rôle détient INSERT, UPDATE ou DELETE. */
  tablesInscriptibles: number;
  tablesTotal: number;
  lectureSeuleParDefaut: string;
  statementTimeout: string;
  /** Vrai seulement si les privilèges EFFECTIFS interdisent l'écriture. */
  ecritureImpossible: boolean;
  motifs: string[];
};

/**
 * Ajoute le verrou à l'URL, en TRAITANT les valeurs contradictoires plutôt qu'en se fiant à la
 * présence du nom du paramètre.
 *
 * La version précédente testait `existant.includes('default_transaction_read_only')` et laissait
 * donc passer intact un `options=-c default_transaction_read_only%3Doff` : le nom était présent,
 * la valeur disait l'inverse. Ici la valeur est lue, et une valeur contradictoire est une ERREUR,
 * pas quelque chose à corriger en silence — une URL qui demande explicitement l'écriture ne doit
 * pas être transformée sans que l'appelant le sache.
 */
export function urlVerrouillee(url: string): string {
  const u = new URL(url);
  const existant = u.searchParams.get('options');

  if (existant) {
    // `-c nom=valeur`, `-c nom = valeur`, ou la forme longue `--nom=valeur`.
    const m = existant.match(/-{1,2}c?\s*default_transaction_read_only\s*(?:=|%3D)\s*(\w+)/i);
    if (m) {
      const valeur = m[1].toLowerCase();
      if (['on', 'true', '1', 'yes'].includes(valeur)) return u.toString();
      throw new Error(
        `GARDE-FOU : l'URL demande explicitement default_transaction_read_only=${m[1]}, ` +
        `ce qui contredit un accès d'audit. Corrigez l'URL plutôt que de la laisser réécrire.`,
      );
    }
  }

  u.searchParams.set('options', existant ? `${existant} ${OPTIONS_LECTURE_SEULE}` : OPTIONS_LECTURE_SEULE);
  /*
   * Deux ré-encodages de `URLSearchParams` doivent être défaits, et tous deux cassent la connexion
   * en silence plutôt que bruyamment :
   *   · `%3D` devient `%253D` — le serveur reçoit alors le littéral « %3D » au lieu de « = » ;
   *   · l'espace devient `+` — mais dans `options`, PostgreSQL ne traduit pas `+` en espace, si
   *     bien que `-c a%3D1+-c b%3D2` n'est plus lu comme deux paramètres. `%20` est la seule
   *     forme correcte. (Attrapé par le témoin, pas par la relecture.)
   */
  return u.toString().replace(/options=([^&]*)/, (_m, v) =>
    `options=${v.replace(/%25/g, '%').replace(/\+/g, '%20')}`);
}

/**
 * Inspecte l'accès courant — UNIQUEMENT par lecture du catalogue système.
 *
 * `has_table_privilege` rend le privilège EFFECTIF, en tenant compte de l'héritage de rôles. Pour
 * un superutilisateur il rend `true` partout, ce qui est précisément le constat qu'on veut rendre
 * visible plutôt que masquer derrière un réglage de session.
 */
export async function inspecterAcces(prisma: PrismaClient): Promise<ProfilAcces> {
  const [id] = await prisma.$queryRawUnsafe<Array<{
    role: string; base: string; super: boolean; ro: string; timeout: string;
  }>>(
    `SELECT current_user AS role,
            current_database() AS base,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS super,
            current_setting('default_transaction_read_only') AS ro,
            current_setting('statement_timeout') AS timeout`,
  );

  const [priv] = await prisma.$queryRawUnsafe<Array<{ inscriptibles: bigint; total: bigint }>>(
    `SELECT count(*) FILTER (
              WHERE has_table_privilege(current_user, c.oid, 'INSERT')
                 OR has_table_privilege(current_user, c.oid, 'UPDATE')
                 OR has_table_privilege(current_user, c.oid, 'DELETE')) AS inscriptibles,
            count(*) AS total
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND n.nspname = 'public'`,
  );

  const tablesInscriptibles = Number(priv.inscriptibles);
  const motifs: string[] = [];
  if (id.super) motifs.push('le rôle est SUPERUTILISATEUR : aucun GRANT ne le contraint');
  if (tablesInscriptibles > 0) motifs.push(`${tablesInscriptibles}/${priv.total} tables du schéma public sont inscriptibles par ce rôle`);
  if (id.ro !== 'on') motifs.push(`default_transaction_read_only = ${id.ro}`);

  return {
    role: id.role, base: id.base, superutilisateur: id.super,
    tablesInscriptibles, tablesTotal: Number(priv.total),
    lectureSeuleParDefaut: id.ro, statementTimeout: id.timeout,
    ecritureImpossible: !id.super && tablesInscriptibles === 0,
    motifs,
  };
}

/**
 * Un client Prisma pour l'audit, avec le profil d'accès RÉEL déclaré par lecture.
 *
 * Ce module ne prétend plus garantir ce qu'il ne peut pas garantir. Si les privilèges effectifs
 * permettent l'écriture, `profil.ecritureImpossible` vaut `false` et `profil.motifs` dit pourquoi :
 * c'est à l'appelant — et au CEO — de décider si une mesure part dans cet état. Un accès d'audit
 * aux droits réellement limités est une intervention autorisée sur la base, pas quelque chose que
 * ce script peut ou doit créer.
 *
 * `exigerLectureSeule: true` fait échouer au lieu de rendre un client permissif.
 */
export async function prismaAudit(
  { exigerLectureSeule = false }: { exigerLectureSeule?: boolean } = {},
): Promise<{ prisma: PrismaClient; profil: ProfilAcces }> {
  const url = process.env.DB_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('GARDE-FOU : ni DB_URL ni DATABASE_URL ne sont définies.');

  const prisma = new PrismaClient({ datasources: { db: { url: urlVerrouillee(url) } } });

  let profil: ProfilAcces;
  try {
    profil = await inspecterAcces(prisma);
  } catch (e) {
    // Une inspection qui échoue ne prouve RIEN : on ferme et on remonte, jamais de repli permissif.
    await prisma.$disconnect().catch(() => {});
    throw new Error(`GARDE-FOU : impossible de vérifier les privilèges de l'accès (${String(e)}).`);
  }

  if (exigerLectureSeule && !profil.ecritureImpossible) {
    await prisma.$disconnect().catch(() => {});
    throw new Error(
      `GARDE-FOU : cet accès peut écrire — ${profil.motifs.join(' ; ')}. ` +
      `Un accès d'audit aux droits limités à la lecture est requis.`,
    );
  }
  return { prisma, profil };
}

/** Requête brute typée. */
export function q<T>(prisma: PrismaClient, sql: string, ...params: unknown[]): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql, ...params);
}
