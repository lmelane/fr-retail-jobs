/**
 * LES CANDIDATS D'UNE CAMPAGNE, PRODUITS DEPUIS LE REGISTRE LUI-MÊME.
 *
 *   node --import tsx apps/aggregator/scripts/ops/campagne-candidats.mts <fichier.json>
 *
 * LECTURE SEULE : un seul SELECT, la session est mise en `default_transaction_read_only`.
 *
 * ── POURQUOI CE PROGRAMME EXISTE ────────────────────────────────────────────────────────────────
 *
 * `source-campaign.mts` attend un fichier de candidats sur disque. Le produire sur un poste puis
 * le transférer dans le conteneur ajoute un intermédiaire qui DATE : la liste décrirait le
 * registre au moment de l'export, pas celui que la campagne va qualifier. Ici, elle est lue à
 * l'instant, dans la base que la campagne va écrire.
 *
 * La requête est `source-campaign-candidates.sql`, versionnée, telle quelle : une ligne JSON par
 * source ACTIVE des familles sous contrat de portail, avec le domaine officiel de la Maison tel
 * que le registre le porte. Rien n'y est deviné — une Maison sans domaine sort `domain: null`, et
 * la campagne le consigne au lieu de l'inventer.
 *
 * ── LE DÉTAIL QUI COMPTE : LES MÉTA-COMMANDES PSQL ──────────────────────────────────────────────
 *
 * Le fichier SQL porte des directives `\pset` destinées à `psql`. Envoyées à Postgres par un
 * pilote, elles font échouer la requête. On les retire — ainsi que les commentaires — avant
 * exécution. Ce n'est pas une réécriture de la requête : le corps SQL reste intact, et c'est lui
 * qui définit les candidats.
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const destination = process.argv[2];
if (!destination) {
  console.error('Usage : campagne-candidats.mts <fichier.json>');
  process.exit(2);
}

const url = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('DB_URL (ou DATABASE_URL) manquante.');
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

const REQUETE = resolve(
  dirname(new URL(import.meta.url).pathname),
  'source-campaign-candidates.sql',
);

async function main(): Promise<number> {
  await prisma.$executeRawUnsafe('SET default_transaction_read_only = on');

  const sql = readFileSync(REQUETE, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('\\') && !l.trim().startsWith('--'))
    .join('\n');

  const lignes = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql);

  /*
   * La requête rend une colonne unique issue de `json_build_object` : on sort la valeur, pas
   * l'enveloppe. Un tableau d'enveloppes ferait échouer la campagne sur `c.key` indéfini —
   * silencieusement, puisque `undefined` ne filtre rien.
   */
  const candidats = lignes.map((l) => Object.values(l)[0]);

  const premier = candidats[0] as { key?: string } | undefined;
  if (!candidats.length || !premier?.key) {
    console.error(`REFUS : ${candidats.length} candidat(s), et le premier ne porte pas de clé.`);
    console.error(`La requête a changé de forme — la campagne qualifierait le vide sans le dire.`);
    return 2;
  }

  const chemin = resolve(destination);
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, JSON.stringify(candidats), { encoding: 'utf8', mode: 0o600 });

  const familles = new Map<string, number>();
  for (const c of candidats as Array<{ kind: string }>) familles.set(c.kind, (familles.get(c.kind) ?? 0) + 1);

  console.log(`   ${candidats.length} candidats écrits dans ${chemin}`);
  console.log(`   familles : ${[...familles].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}=${n}`).join(' · ')}`);
  return 0;
}

main()
  .then((code) => prisma.$disconnect().then(() => process.exit(code)))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
