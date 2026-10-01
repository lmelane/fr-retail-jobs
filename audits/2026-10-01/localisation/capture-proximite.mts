/**
 * D-496 — LA REQUÊTE SERVIE, telle que `getJobs` l'envoie à la base, capturée sur une base JETABLE (migrations de ce
 * lot, base de villes GeoNames chargée par villes.py), puis rejouée en lecture seule sur la production par `psql`
 * (README de ce dossier). Même méthode que D-488 (`../d488-langues-marche/capture-sql.mts`).
 *
 * La production n'a pas encore les colonnes `geo*` (migration non appliquée) : avec PRODUCTION=1, le texte capturé lit
 * le point natif (`latitude`, `longitude`) à leur place. Le plan rejoué est donc celui de la proximité sur les offres
 * qui ont aujourd'hui des coordonnées (France 97 %), sans l'index `Job_geo_point_actif_idx` ; ailleurs (États-Unis 38 %,
 * Royaume-Uni 9 %) le nombre d'offres dans les cercles est sous-estimé.
 *
 * Usage : CODE_ROOT=<arbre> DATABASE_URL=<base jetable> [PRODUCTION=1] npx tsx capture-proximite.mts <sortie.sql>
 */
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || !/d496/.test(url.pathname)) throw new Error('Base refusée : base jetable du lot D-496 seulement');
const client = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
let derniere: { query: string; params: string } | undefined;
client.$on('query', (e) => { if (e.query.includes('WITH base AS MATERIALIZED')) derniere = { query: e.query, params: e.params }; });
(globalThis as unknown as { prisma: PrismaClient }).prisma = client;
const jobs = await import(`${process.env.CODE_ROOT}/apps/api/lib/jobs.ts`);
const index = await import(`${process.env.CODE_ROOT}/apps/api/lib/search-index.ts`);
// La génération de recherche doit exister et être prête : sur la base jetable, elle est déclarée prête sans indexer les
// offres (seul le texte de la requête est capturé, ses résultats ne comptent pas).
await index.initializeSearchIndex();
await client.$executeRaw`TRUNCATE "SearchPending"`;
await client.$executeRaw`UPDATE "SearchGeneration" SET "readyAt" = now() WHERE "readyAt" IS NULL`;

const litteral = (v: unknown): string => v === null ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : v instanceof Date ? `'${v.toISOString()}'` : Array.isArray(v) ? `ARRAY[${v.map(litteral).join(',')}]::text[]`
  : `'${String(v).replace(/'/g, "''")}'`;

/** Les cas : la référence D-488 sans lieu, puis des lieux de villes, l'accueil (filtre ville) et un lieu inconnu. */
export const CAS: { nom: string; filtres: Record<string, string | string[]> }[] = [
  { nom: 'FR conseiller de vente (référence D-488, sans lieu)', filtres: { marche: 'FR', q: 'conseiller de vente' } },
  { nom: 'FR sans critère', filtres: { marche: 'FR' } },
  { nom: 'FR Chennevières-sur-Marne', filtres: { marche: 'FR', lieu: 'Chennevières-sur-Marne' } },
  { nom: 'FR conseiller de vente, Chennevières-sur-Marne', filtres: { marche: 'FR', q: 'conseiller de vente', lieu: 'Chennevières-sur-Marne' } },
  { nom: 'FR Paris', filtres: { marche: 'FR', lieu: 'Paris' } },
  { nom: 'FR conseiller de vente, Paris', filtres: { marche: 'FR', q: 'conseiller de vente', lieu: 'Paris' } },
  { nom: 'FR Lyon', filtres: { marche: 'FR', lieu: 'Lyon' } },
  { nom: 'FR Paris 15e (75) (D-499)', filtres: { marche: 'FR', lieu: 'Paris 15e (75)' } },
  { nom: 'FR 94430 (code postal, D-499)', filtres: { marche: 'FR', lieu: '94430' } },
  { nom: 'FR accueil : métier + 3 villes (filtre ville)', filtres: { marche: 'FR', metier: 'sales-advisor', ville: ['Paris', 'Lyon', 'Nice'] } },
  { nom: 'FR lieu inconnu (repli texte)', filtres: { marche: 'FR', lieu: 'Zzyzxville' } },
  { nom: 'US sales advisor, New York', filtres: { marche: 'US', q: 'sales advisor', lieu: 'New York' } },
  { nom: 'US New York', filtres: { marche: 'US', lieu: 'New York' } },
  { nom: 'GB London', filtres: { marche: 'GB', lieu: 'London' } },
  { nom: 'DE München', filtres: { marche: 'DE', lieu: 'München' } },
];

const sortie: string[] = ['\\timing on', '\\pset tuples_only on'];
for (const c of CAS) {
  derniere = undefined;
  // Le client annonce le contrat de proximité (`x-catwalks-client: 2`) ; le code d'avant le lot ignore la clé.
  await jobs.getJobs({ ...jobs.parseFilters(c.filtres), proximite: true });
  if (!derniere) throw new Error(`Requête servie non capturée : ${c.nom}`);
  const params = JSON.parse(derniere.params) as unknown[];
  // Du plus grand indice au plus petit : $12 avant $1.
  let texte = params.reduceRight<string>((sql, v, i) => sql.replaceAll(`$${i + 1}`, litteral(v)), derniere.query);
  // La fonction de clé de lieu n'existe pas encore en production : la normalisation (une seule expression au lieu de
  // quatre) la remplace ; elle n'est évaluée que pour les offres sans point d'un filtre `ville` (3 % en France).
  if (process.env.PRODUCTION) texte = texte.replaceAll('"geoLatitude"', 'latitude').replaceAll('"geoLongitude"', 'longitude')
    .replaceAll('catwalks_lieu_cle(', 'catwalks_normaliser_texte(');
  sortie.push(`\\echo '${c.nom.replace(/'/g, "''")}'`, `SELECT r.total, md5(r.page::text) FROM (${texte}) r;`);
}
writeFileSync(process.argv[2], sortie.join('\n') + '\n');
await client.$disconnect();
process.exit(0);
