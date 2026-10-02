/**
 * D-510 — LA REQUÊTE SERVIE, telle que `getJobs` l'envoie à la base au contrat 2, capturée puis rejouée en lecture seule
 * sur la production par `psql` (README de ce dossier). Même méthode que D-488 (`../../2026-10-01/d488-langues-marche/`)
 * et D-496 (`../../2026-10-01/localisation/`), une différence : la capture lit la production elle-même (modèle de
 * recherche, Maisons, répartition des métiers, base de villes), pour que le texte soit exactement celui qu'elle
 * servirait. Session en lecture seule (`default_transaction_read_only`, posé dans l'URL, que Prisma transmet), et la
 * requête servie n'est JAMAIS exécutée par la capture : elle est interceptée, puis la recherche est abandonnée.
 *
 * Usage (depuis la racine du dépôt) :
 *   python3 apps/aggregator/scripts/ops/db.py readonly env CODE_ROOT=<arbre> npx tsx \
 *     audits/2026-10-02/fraicheur-d510/capture-servie.mts <sortie.sql>      (CONTRAT=1 : la requête du contrat 1)
 * Les cas : les 137 recherches de D-488 (`cas-grille.txt`), puis les 15 recherches de proximité de D-496.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const brute = new URL(process.env.DATABASE_URL ?? '');
brute.searchParams.set('options', '-c default_transaction_read_only=on -c statement_timeout=25000');
const client = new PrismaClient({ datasources: { db: { url: brute.toString() } } });
const MARQUE = 'WITH base AS MATERIALIZED';
class Capturee extends Error {}
let capturee: { strings: readonly string[]; values: readonly unknown[] } | undefined;
const lire = client.$queryRaw.bind(client);
(client as unknown as { $queryRaw: unknown }).$queryRaw = (requete: unknown, ...valeurs: unknown[]) => {
  // Un gabarit étiqueté (`prisma.$queryRaw\`…\``) arrive en tableau de chaînes ; un `Prisma.sql` porte `strings`.
  const sql = requete as { strings?: readonly string[]; values?: readonly unknown[] };
  const texte = Array.isArray(requete) ? requete.join('') : sql.strings?.join('') ?? '';
  if (sql.strings && sql.values && texte.includes(MARQUE)) {
    capturee = { strings: sql.strings, values: sql.values };
    return Promise.reject(new Capturee());
  }
  if (!/^\s*(SELECT|WITH)\b/i.test(texte)) return Promise.reject(new Error(`Lecture seule : requête refusée ${texte.slice(0, 60)}`));
  return (lire as (...a: unknown[]) => unknown)(requete, ...valeurs);
};
for (const m of ['$executeRaw', '$executeRawUnsafe', '$queryRawUnsafe', '$transaction'] as const) {
  (client as unknown as Record<string, unknown>)[m] = () => { throw new Error(`Lecture seule : ${m} refusé`); };
}
(globalThis as unknown as { prisma: PrismaClient }).prisma = client;
const jobs = await import(`${process.env.CODE_ROOT}/apps/api/lib/jobs.ts`);

const litteral = (v: unknown): string => v === null ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : v instanceof Date ? `'${v.toISOString()}'` : Array.isArray(v) ? `ARRAY[${v.map(litteral).join(',')}]::text[]`
  : `'${String(v).replace(/'/g, "''")}'`;

const grille = readFileSync(new URL('../../2026-10-01/d488-langues-marche/resultats/cas-grille.txt', import.meta.url), 'utf8').trim();
const CAS: { nom: string; filtres: Record<string, string | string[]> }[] = [
  ...grille.split(',').map((c) => {
    const i = c.indexOf(':');
    return { nom: `${c.slice(0, i)} ${c.slice(i + 1)}`, filtres: { marche: c.slice(0, i), q: c.slice(i + 1) } };
  }),
  { nom: 'FR sans critère', filtres: { marche: 'FR' } },
  { nom: 'FR Chennevières-sur-Marne', filtres: { marche: 'FR', lieu: 'Chennevières-sur-Marne' } },
  { nom: 'FR conseiller de vente, Chennevières-sur-Marne', filtres: { marche: 'FR', q: 'conseiller de vente', lieu: 'Chennevières-sur-Marne' } },
  { nom: 'FR Paris', filtres: { marche: 'FR', lieu: 'Paris' } },
  { nom: 'FR conseiller de vente, Paris', filtres: { marche: 'FR', q: 'conseiller de vente', lieu: 'Paris' } },
  { nom: 'FR Lyon', filtres: { marche: 'FR', lieu: 'Lyon' } },
  { nom: 'FR Paris 15e (75)', filtres: { marche: 'FR', lieu: 'Paris 15e (75)' } },
  { nom: 'FR 94430 (code postal)', filtres: { marche: 'FR', lieu: '94430' } },
  { nom: 'FR accueil : métier + 3 villes', filtres: { marche: 'FR', metier: 'sales-advisor', ville: ['Paris', 'Lyon', 'Nice'] } },
  { nom: 'FR lieu inconnu (repli texte)', filtres: { marche: 'FR', lieu: 'Zzyzxville' } },
  { nom: 'US sales advisor, New York', filtres: { marche: 'US', q: 'sales advisor', lieu: 'New York' } },
  { nom: 'US New York', filtres: { marche: 'US', lieu: 'New York' } },
  { nom: 'GB London', filtres: { marche: 'GB', lieu: 'London' } },
  { nom: 'DE München', filtres: { marche: 'DE', lieu: 'München' } },
  { nom: 'FR conseiller de vente (sans lieu)', filtres: { marche: 'FR', q: 'conseiller de vente' } },
];

const sortie: string[] = ['\\timing on', '\\pset tuples_only on'];
for (const c of CAS) {
  capturee = undefined;
  // Le contrat 2 tel que la route le pose (`x-catwalks-client: 2`) ; le code d'avant D-510 ignore `fraicheur`.
  try {
    // CONTRAT=1 : sans l'en-tête (catwalks.io en production), pour prouver que sa requête ne change pas.
    const contrat2 = process.env.CONTRAT !== '1' ? { proximite: true, comprendre: true, fraicheur: true } : {};
    await jobs.getJobs({ ...jobs.parseFilters(c.filtres), ...contrat2 });
  } catch (erreur) {
    if (!capturee) throw erreur;
  }
  if (!capturee) throw new Error(`Requête servie non capturée : ${c.nom}`);
  const s = capturee;
  const texte = s.strings.reduce((acc, part, i) => acc + part + (i < s.values.length ? litteral(s.values[i]) : ''), '');
  sortie.push(`\\echo '${c.nom.replace(/'/g, "''")}'`, `SELECT r.total, md5(r.page::text) FROM (${texte}) r;`);
}
writeFileSync(process.argv[2], sortie.join('\n') + '\n');
await client.$disconnect();
console.log(`${CAS.length} requêtes capturées`);
process.exit(0);
