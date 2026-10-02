/**
 * D-515 §1 (suites du classement, lecture D-492 du 02/10/2026) — LE CONTRAT 1 NE CHANGE PAS. Copie du mode `capture` de
 * `../classement-r143/mesure-servie.mts` (même interception, même adaptation de la retenue, mêmes 152 recherches de D-510),
 * plus 12 recherches qui portent les filtres que ce lot touche (secteur, langue, avec et sans requête, lieu, contrat) :
 * sans elles, les 152 ne passeraient par aucune ligne modifiée. La requête du contrat 1 (`CONTRAT=1`) est capturée avec
 * le code d'avant et celui d'après, comparée par `../fraicheur-d510/comparer-contrat1.py`, puis exécutée en lecture seule.
 *
 *   CATWALKS_DB_ACCESS=<accès> python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
 *     'cd apps/api && CONTRAT=1 CODE_ROOT=<arbre> npx tsx ../../audits/2026-10-02/suites-classement/capture-contrat1.mts <sortie.sql>'
 * Jamais entre 15:30 et 18:30 UTC.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';

const brute = new URL(process.env.DATABASE_URL ?? '');
brute.searchParams.set('options', '-c default_transaction_read_only=on -c statement_timeout=60000');
const client = new PrismaClient({ datasources: { db: { url: brute.toString() } } });
const [{ ro }] = await client.$queryRawUnsafe<{ ro: string }[]>(`SELECT current_setting('transaction_read_only') ro`);
if (ro !== 'on') throw new Error('garde : la session n’est pas en lecture seule');

const RETENUE = 'AND available_source."availabilityHold" IS NULL';
const sansRetenue = (s: string) => s.split(RETENUE).join('AND true');
const MARQUE = 'WITH base AS MATERIALIZED';
const MODE = 'capture';
class Capturee extends Error {}
let capturee: { strings: string[]; values: readonly unknown[] } | undefined;
let executee: unknown;
const lire = client.$queryRaw.bind(client);
(client as unknown as { $queryRaw: unknown }).$queryRaw = async (requete: unknown, ...valeurs: unknown[]) => {
  const sql = requete as { strings?: readonly string[]; values?: readonly unknown[] };
  const texte = Array.isArray(requete) ? requete.join('') : sql.strings?.join('') ?? '';
  if (!/^\s*(SELECT|WITH)\b/i.test(texte)) throw new Error(`Lecture seule : requête refusée ${texte.slice(0, 60)}`);
  if (!sql.strings || !sql.values) return (lire as (...a: unknown[]) => unknown)(requete, ...valeurs);
  const reecrite = Prisma.sql(sql.strings.map(sansRetenue), ...(sql.values as unknown[]));
  if (texte.includes(MARQUE)) {
    capturee = { strings: reecrite.strings, values: reecrite.values };
    if (MODE === 'page') executee = await lire(reecrite);
    throw new Capturee();
  }
  return lire(reecrite);
};
for (const m of ['$executeRaw', '$executeRawUnsafe', '$queryRawUnsafe', '$transaction'] as const) {
  (client as unknown as Record<string, unknown>)[m] = () => { throw new Error(`Lecture seule : ${m} refusé`); };
}
(globalThis as unknown as { prisma: PrismaClient }).prisma = client;
const jobs = await import(`${process.env.CODE_ROOT}/apps/api/lib/jobs.ts`);

const litteral = (v: unknown): string => v === null ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : typeof v === 'bigint' ? String(v)
  : v instanceof Date ? `'${v.toISOString()}'` : Array.isArray(v) ? `ARRAY[${v.map(litteral).join(',')}]::text[]`
  : `'${String(v).replace(/'/g, "''")}'`;

/** Le contrat 2 tel que la route le pose (`x-catwalks-client: 2`) ; `CONTRAT=1` : sans l'en-tête. */
const contrat2 = process.env.CONTRAT === '1' ? {} : { proximite: true, comprendre: true, fraicheur: true, nonPrecisees: true };

async function servir(filtres: Record<string, unknown>): Promise<void> {
  capturee = undefined;
  executee = undefined;
  try {
    await jobs.getJobs({ ...filtres, ...contrat2 });
  } catch (erreur) {
    if (!(erreur instanceof Capturee) && !(erreur as { cause?: unknown }).cause?.constructor?.name?.includes('Capturee') && !capturee) throw erreur;
  }
  if (!capturee) throw new Error('requête servie non capturée');
}

const [sortie] = process.argv.slice(2);
{
  const grille = readFileSync(new URL('../../2026-10-01/d488-langues-marche/resultats/cas-grille.txt', import.meta.url), 'utf8').trim();
  const CAS: { nom: string; filtres: Record<string, unknown> }[] = [
    ...grille.split(',').map((c) => {
      const i = c.indexOf(':');
      return { nom: `${c.slice(0, i)} ${c.slice(i + 1)}`, filtres: { marche: c.slice(0, i), q: c.slice(i + 1), filtres: {} } };
    }),
    { nom: 'FR sans critère', filtres: { marche: 'FR', filtres: {} } },
    { nom: 'FR Chennevières-sur-Marne', filtres: { marche: 'FR', lieu: 'Chennevières-sur-Marne', filtres: {} } },
    { nom: 'FR conseiller de vente, Chennevières-sur-Marne', filtres: { marche: 'FR', q: 'conseiller de vente', lieu: 'Chennevières-sur-Marne', filtres: {} } },
    { nom: 'FR Paris', filtres: { marche: 'FR', lieu: 'Paris', filtres: {} } },
    { nom: 'FR conseiller de vente, Paris', filtres: { marche: 'FR', q: 'conseiller de vente', lieu: 'Paris', filtres: {} } },
    { nom: 'FR Lyon', filtres: { marche: 'FR', lieu: 'Lyon', filtres: {} } },
    { nom: 'FR Paris 15e (75)', filtres: { marche: 'FR', lieu: 'Paris 15e (75)', filtres: {} } },
    { nom: 'FR 94430 (code postal)', filtres: { marche: 'FR', lieu: '94430', filtres: {} } },
    { nom: 'FR accueil : métier + 3 villes', filtres: { marche: 'FR', filtres: { metier: ['sales-advisor'], ville: ['Paris', 'Lyon', 'Nice'] } } },
    { nom: 'FR lieu inconnu (repli texte)', filtres: { marche: 'FR', lieu: 'Zzyzxville', filtres: {} } },
    { nom: 'US sales advisor, New York', filtres: { marche: 'US', q: 'sales advisor', lieu: 'New York', filtres: {} } },
    { nom: 'US New York', filtres: { marche: 'US', lieu: 'New York', filtres: {} } },
    { nom: 'GB London', filtres: { marche: 'GB', lieu: 'London', filtres: {} } },
    { nom: 'DE München', filtres: { marche: 'DE', lieu: 'München', filtres: {} } },
    { nom: 'FR conseiller de vente (sans lieu)', filtres: { marche: 'FR', q: 'conseiller de vente', filtres: {} } },
    // Les filtres que D-515 §1 rend tolérants au contrat 2 : au contrat 1, la même requête qu'avant.
    { nom: 'FR secteur BEAUTY', filtres: { marche: 'FR', filtres: { secteur: ['BEAUTY'] } } },
    { nom: 'FR secteur FASHION + JEWELRY', filtres: { marche: 'FR', filtres: { secteur: ['FASHION', 'JEWELRY'] } } },
    { nom: 'FR secteur unclassified', filtres: { marche: 'FR', filtres: { secteur: ['unclassified'] } } },
    { nom: 'FR langue en', filtres: { marche: 'FR', filtres: { langue: ['en'] } } },
    { nom: 'FR conseiller de vente, secteur BEAUTY', filtres: { marche: 'FR', q: 'conseiller de vente', filtres: { secteur: ['BEAUTY'] } } },
    { nom: 'FR Paris, secteur FASHION, langue fr', filtres: { marche: 'FR', lieu: 'Paris', filtres: { secteur: ['FASHION'], langue: ['fr'] } } },
    { nom: 'FR CDI, secteur BEAUTY', filtres: { marche: 'FR', filtres: { contrat: ['PERMANENT'], secteur: ['BEAUTY'] } } },
    { nom: 'US secteur RETAIL', filtres: { marche: 'US', filtres: { secteur: ['RETAIL'] } } },
    { nom: 'US sales advisor, secteur BEAUTY', filtres: { marche: 'US', q: 'sales advisor', filtres: { secteur: ['BEAUTY'] } } },
    { nom: 'DE langue de', filtres: { marche: 'DE', filtres: { langue: ['de'] } } },
    { nom: 'GB London, secteur FASHION', filtres: { marche: 'GB', lieu: 'London', filtres: { secteur: ['FASHION'] } } },
    { nom: 'JP secteur BEAUTY, langue ja', filtres: { marche: 'JP', filtres: { secteur: ['BEAUTY'], langue: ['ja'] } } },
  ];
  const lignes: string[] = ['\\timing on', '\\pset tuples_only on'];
  for (const c of CAS) {
    await servir(c.filtres);
    const s = capturee!;
    const texte = s.strings.reduce((acc, part, i) => acc + part + (i < s.values.length ? litteral(s.values[i]) : ''), '');
    lignes.push(`\\echo '${c.nom.replace(/'/g, "''")}'`, `SELECT r.total, md5(r.page::text) FROM (${texte}) r;`);
  }
  writeFileSync(sortie, lignes.join('\n') + '\n');
  console.log(`${CAS.length} requêtes capturées`);
}
await client.$disconnect();
process.exit(0);
