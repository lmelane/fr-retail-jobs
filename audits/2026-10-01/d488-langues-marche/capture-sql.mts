/**
 * D-488 — la requête SERVIE, telle que `getJobs` l'envoie à la base (CTE `base`, jointures, facettes, page), capturée
 * sur la base JETABLE puis rejouée en lecture seule sur la production par `psql` (voir README). Le texte ne dépend que
 * du code (CODE_ROOT), du manifeste actif (le même qu'en production, empreinte vérifiée par `requetes.mts`) et de la
 * requête : rejouée en production, elle mesure le plan et la durée réels, sur les vraies offres.
 *
 * Usage : CODE_ROOT=<arbre> DATABASE_URL=<base jetable> [EXPLAIN=1] [CAS=FR:q,…] npx tsx capture-sql.mts <sortie.sql>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || url.port !== '56632' || url.pathname !== '/catwalks_d488_mesure') throw new Error('Base refusée');
const client = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
let derniere: { query: string; params: string } | undefined;
// SUGGESTIONS=1 : la requête qui valide les suggestions d'intitulés (une recherche EXISTS par candidat, `suggestions.ts`).
const suggestions = !!process.env.SUGGESTIONS;
const marque = suggestions ? 'suggestions ORDER BY position' : 'WITH base AS MATERIALIZED';
client.$on('query', (e) => { if (e.query.includes(marque)) derniere = { query: e.query, params: e.params }; });
// Le journal de Prisma abrège les paramètres d'une requête trop longue (celle des suggestions) : pour elle, la requête
// est lue à la source, dans l'objet `Prisma.Sql` passé à `$queryRaw`.
let source: { strings: readonly string[]; values: readonly unknown[] } | undefined;
const lireRequete = client.$queryRaw.bind(client);
(client as unknown as { $queryRaw: unknown }).$queryRaw = (requete: unknown, ...valeurs: unknown[]) => {
  const sql = requete as { strings?: readonly string[]; values?: readonly unknown[] };
  if (sql.strings && sql.values && sql.strings.join('').includes(marque)) source = { strings: sql.strings, values: sql.values };
  return (lireRequete as (...a: unknown[]) => unknown)(requete, ...valeurs);
};
(globalThis as unknown as { prisma: PrismaClient }).prisma = client;
const jobs = await import(`${process.env.CODE_ROOT}/apps/api/lib/jobs.ts`);
const suggest = await import(`${process.env.CODE_ROOT}/apps/api/lib/suggestions.ts`);
const { MARCHES } = await import('@catwalks/db/marches');

const litteral = (v: unknown): string => v === null ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : v instanceof Date ? `'${v.toISOString()}'` : Array.isArray(v) ? `ARRAY[${v.map(litteral).join(',')}]::text[]`
  : `'${String(v).replace(/'/g, "''")}'`;
const cas = process.env.CAS?.startsWith('@') ? readFileSync(process.env.CAS.slice(1), 'utf8').trim() : process.env.CAS;
const CAS: [string, string][] = cas ? cas.split(',').map((c) => [c.slice(0, c.indexOf(':')), c.slice(c.indexOf(':') + 1)] as [string, string])
  : [['FR', 'conseiller de vente'], ['US', 'sales advisor'], ['DE', 'Verkaufsberater'], ['JP', 'セールスアドバイザー'],
    ['CN', '销售顾问'], ['FR', 'responsable de boutique'], ['IT', 'addetto vendite']];
const sortie: string[] = ['\\timing on', '\\pset tuples_only on'];
for (const [marche, q] of CAS) {
  derniere = undefined; source = undefined;
  let texte: string;
  if (suggestions) {
    const m = MARCHES[marche as keyof typeof MARCHES];
    await suggest.suggestTitlesDetaillees(q, { code: m.code, pays: m.pays, marche: m });
    if (!source) throw new Error(`Requête des suggestions non capturée : ${marche} ${q}`);
    const s = source;
    texte = s.strings.reduce((acc, part, i) => acc + part + (i < s.values.length ? litteral(s.values[i]) : ''), '');
  } else {
    await jobs.getJobs(jobs.parseFilters({ marche, q }));
    if (!derniere) throw new Error(`Requête servie non capturée : ${marche} ${q}`);
    const params = JSON.parse(derniere.params) as unknown[];
    // Du plus grand indice au plus petit : $12 avant $1.
    texte = params.reduceRight<string>((sql, v, i) => sql.replaceAll(`$${i + 1}`, litteral(v)), derniere.query);
  }
  // Le résultat n'est pas affiché (la page et les facettes) : seul compte un résumé stable et la durée.
  sortie.push(`\\echo '${marche} ${q.replace(/'/g, "''")}'`, process.env.EXPLAIN ? `EXPLAIN (ANALYZE, BUFFERS) ${texte};`
    : suggestions ? `SELECT count(*) || ':' || md5(string_agg(value, '|')) FROM (${texte}) r;` : `SELECT r.total, md5(r.page::text) FROM (${texte}) r;`);
}
writeFileSync(process.argv[2], sortie.join('\n') + '\n');
await client.$disconnect();
process.exit(0);
