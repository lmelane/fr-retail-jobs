/**
 * R-143 §7 (D-513, lecture D-492 du 02/10/2026) — LA REQUÊTE SERVIE, AVANT ET APRÈS LE CLASSEMENT, SUR LA PRODUCTION EN
 * LECTURE SEULE. Même méthode que D-510 (`../fraicheur-d510/capture-servie.mts`) : la requête que `getJobs` envoie est
 * interceptée, jamais exécutée par Prisma.
 *
 * Une adaptation, et une seule : la production n'a pas encore la colonne `JobSource.availabilityHold` (migration
 * `20261002140000` de R-143 §2, appliquée avec la release r6) ; le code de `development`, avant comme après ce lot, la
 * nomme dans `publicJobSql`. Sans retenue posée, son prédicat (`… "availabilityHold" IS NULL`) vaut vrai pour toute
 * ligne : il est remplacé par `true` dans le texte, à l'identique des deux côtés. Rien d'autre n'est réécrit.
 *
 * Deux modes (`MODE`) :
 *   · `page` : 10 requêtes réelles de la grille de D-488 et l'accueil de 5 profils réels convertis (`profils.json`) ;
 *     la requête servie est EXÉCUTÉE (lecture seule) et sa première page (identifiants, clés, points du classement) est
 *     complétée des faits de chaque offre, lus par un SELECT sur `Job` ;
 *   · `capture` : les 152 recherches de D-510 (137 de D-488, 15 de D-496), écrites en SQL littéral pour un rejeu `psql`
 *     (latences, et `CONTRAT=1` : la requête du contrat 1, qui ne doit pas changer).
 *
 *   CATWALKS_DB_ACCESS=<accès> python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
 *     'cd apps/api && MODE=page CODE_ROOT=<arbre> npx tsx ../../audits/2026-10-02/classement-r143/mesure-servie.mts <profils.json> <sortie>'
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
const MODE = process.env.MODE ?? 'page';
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

const [entree, sortie] = process.argv.slice(2);
if (MODE === 'capture') {
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
} else {
  const { profils } = JSON.parse(readFileSync(entree, 'utf8')) as { profils: { profil: string; marche: string; metiers: string[]; lieux: string[];
    contrats: string[]; teletravail: boolean | null; salaire: { montant: number; devise: string; periode: string } | null }[] };
  /** 10 requêtes de la grille de D-488, cinq marchés. */
  const REQUETES: [string, string][] = [
    ['FR', 'Conseiller de vente'], ['FR', 'Responsable de boutique'], ['FR', 'Conseiller beauté'], ['FR', 'Hôte de caisse'],
    ['FR', 'Visual merchandiser'], ['US', 'Sales advisor'], ['US', 'Store manager'], ['GB', 'Beauty advisor'], ['DE', 'Verkaufsberater'],
    ['ES', 'Asesor de ventas'],
  ];
  const cas = [
    ...REQUETES.map(([marche, q]) => ({ nom: `${marche} ${q}`, type: 'requete', q, profil: null, filtres: { marche, q, filtres: {} } })),
    // L'accueil de l'inscrit (R-141 §3, D-497) : son premier métier et sa première ville ; ses préférences pour le classement.
    ...profils.map((p) => ({ nom: `${p.profil} ${p.marche} ${p.metiers[0]} · ${p.lieux[0]}`, type: 'profil', q: null, profil: p,
      filtres: { marche: p.marche, lieu: p.lieux[0], filtres: { metier: [p.metiers[0]] },
        preferences: { metiers: p.metiers, lieux: p.lieux, contrats: p.contrats, ...(p.teletravail === null ? {} : { teletravail: p.teletravail }),
          ...(p.salaire ? { salaire: p.salaire } : {}) } } })),
  ];
  const resultats = [];
  // Les 5 premiers profils dont l'accueil rend des offres ; les autres (une ville que le catalogue ne connaît pas) sont
  // nommés, sans page à comparer. Le total ne dépend pas de l'ordre : avant et après retiennent les mêmes profils.
  const vides: string[] = [];
  let profilsRetenus = 0;
  for (const c of cas) {
    if (c.type === 'profil' && profilsRetenus >= 5) break;
    const debut = Date.now();
    await servir(c.filtres);
    const [r] = executee as { total: number; page: { id: string; k: unknown[]; c?: (number | null)[] }[] | null }[];
    if (c.type === 'profil' && r.total === 0) { vides.push(c.nom); continue; }
    if (c.type === 'profil') profilsRetenus++;
    const page = (r.page ?? []).slice(0, 25);
    const ids = page.map((p) => p.id);
    const faits = await lire(Prisma.sql`
      SELECT j.id, j.title AS titre, c.name AS maison, j.city AS ville, j."occupationCode", j."employmentTerm", j."programType",
        j."engagementType", j."workplaceType", j."salaryMin"::float8 AS "salaryMin", j."salaryMax"::float8 AS "salaryMax", j."salaryCurrency",
        j."salaryPeriod", round((extract(epoch FROM now() AT TIME ZONE 'UTC') - extract(epoch FROM LEAST(j."postedAt", j."firstSeenAt")))::numeric / 86400, 1)::float8 AS "ageJours"
      FROM "Job" j JOIN "Company" c ON c.id = j."companyId" WHERE j.id IN (${Prisma.join(ids.length ? ids : ['-'])})
      UNION ALL
      SELECT 'cw_' || d.id, d.title, d.company, d.city, d."occupationCode", d."employmentTerm", d."programType", d."engagementType",
        d."workplaceType", d."salaryMin"::float8, d."salaryMax"::float8, d."salaryCurrency", d."salaryPeriod",
        round((extract(epoch FROM now() AT TIME ZONE 'UTC') - extract(epoch FROM LEAST(d."postedAt", d."receivedAt")))::numeric / 86400, 1)::float8
      FROM "DirectOffer" d WHERE 'cw_' || d.id IN (${Prisma.join(ids.length ? ids : ['-'])})`) as Record<string, unknown>[];
    const parId = new Map(faits.map((f) => [f.id as string, f]));
    resultats.push({ nom: c.nom, type: c.type, q: c.q, profil: c.profil, total: r.total, ms: Date.now() - debut,
      page: page.map((p) => ({ ...parId.get(p.id), id: p.id, origine: p.id.startsWith('cw_') ? 'CATWALKS' : 'AGREGEE', points: p.c ?? null })) });
  }
  writeFileSync(sortie, JSON.stringify(resultats, null, 1));
  console.log(`${resultats.length} cas → ${sortie} ; profils sans offre à l'accueil : ${vides.join(' ; ') || 'aucun'}`);
}
await client.$disconnect();
process.exit(0);
