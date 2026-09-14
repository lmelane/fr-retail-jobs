/**
 * PURGER LES CLONES DE PRÉFLIGHT PÉRIMÉS — la dette d'espace que chaque run borné laisse derrière lui.
 *
 * Chaque exécution bornée restaure un clone de vérification dans `catwalks_p7_preflight_<horodatage>` et
 * **ne le supprime jamais**. À ~2,7 Go pièce, une quinzaine de runs suffit à saturer le disque — et c'est le
 * préflight lui-même qui finit par refuser de démarrer, faute de place pour le dump et le clone qu'il doit
 * créer. Mesuré le 2026-09-14 : 8 clones, **21 Go**, sur un disque qui n'avait plus que 1,5 Gio libres.
 *
 * *Un refus de préflight pour cause d'espace n'est pas un incident de production : c'est du ménage qu'aucun
 * programme ne faisait.*
 *
 * Deux gardes, parce qu'une purge de bases ne se rattrape pas :
 *  · le préfixe est FIXE et non paramétrable — impossible de viser autre chose que des clones de préflight ;
 *  · `--keep-latest=N` conserve les N plus récents, utiles pour comparer un refus à son état.
 *
 * `--apply` est obligatoire. Sans lui, la liste est affichée et rien n'est supprimé.
 *
 * usage: db.py clone npx tsx scripts/ops/purge-preflight-clones.mts [--keep-latest=2] [--apply]
 */
import { PrismaClient } from '@prisma/client';

/** Non paramétrable, délibérément : le rayon d'action doit être lisible dans le code, pas dans un argument. */
const PREFIX = 'catwalks_p7_preflight_';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const keepLatest = Number(arg('keep-latest') ?? 2);
const APPLY = process.argv.includes('--apply');

const p = new PrismaClient();
const rows: any[] = await p.$queryRawUnsafe(
  `SELECT datname, pg_database_size(datname) octets FROM pg_database
   WHERE datname LIKE $1 ORDER BY datname DESC`, `${PREFIX}%`);

// Le nom porte l'horodatage : l'ordre alphabétique décroissant EST l'ordre chronologique inverse.
const garder = rows.slice(0, Math.max(0, keepLatest));
const aPurger = rows.slice(Math.max(0, keepLatest));

for (const g of garder) console.log(`  conservé   ${g.datname}`);
let octets = 0;
for (const x of aPurger) {
  octets += Number(x.octets);
  if (APPLY) {
    // Un backend encore attaché empêcherait le DROP : on ferme les connexions d'abord, jamais la nôtre.
    await p.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      x.datname);
    await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${x.datname}"`);
  }
  console.log(`  ${APPLY ? 'supprimé  ' : 'à purger  '} ${x.datname}`);
}

console.log(JSON.stringify({
  trouves: rows.length, conserves: garder.length, purges: aPurger.length,
  gigaoctets: Math.round(octets / 1073741824 * 10) / 10, applique: APPLY,
}, null, 1));
await p.$disconnect();
