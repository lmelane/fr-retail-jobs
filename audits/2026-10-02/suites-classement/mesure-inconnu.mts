/**
 * D-515 §1, R-143 §10 (lecture D-492 du 02/10/2026, suites du classement) — LES FILTRES SECTEUR ET LANGUE, AVANT ET APRÈS,
 * PAR MARCHÉ ET PAR VALEUR, SUR LA PRODUCTION EN LECTURE SEULE. Même méthode que `../classement-r143/mesure-servie.mts` :
 * la requête que `getJobs` envoie au contrat 2 est interceptée et exécutée en lecture seule ; on lit le `total` servi.
 *
 * Pour chaque marché : la recherche sans critère (ses facettes donnent les secteurs et les langues proposés), puis chaque
 * valeur de secteur et de langue proposée, seule ; avec `SECTION=1` (code d'après), aussi sa section des inconnues. Le code d'avant (`CODE_ROOT` = l'arbre de `development` avant ce lot)
 * et le code d'après rendent chacun leur `total` ; on vérifie aussi, à l'arbre d'après, que `totalConfirmes` (les offres
 * reconnues) égale le `total` d'avant : la section reconnue est exactement l'ancien filtre strict.
 *
 * Adaptation : si la production n'a pas encore `JobSource.availabilityHold` (migration `20261002140000`, release r6), le
 * prédicat `… "availabilityHold" IS NULL`, vrai pour toute ligne sans retenue, est remplacé par `true`, à l'identique
 * des deux côtés. Rien d'autre n'est réécrit.
 *
 *   CATWALKS_DB_ACCESS=<accès> python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
 *     'cd apps/api && CODE_ROOT=<arbre> npx tsx ../../audits/2026-10-02/suites-classement/mesure-inconnu.mts <sortie.json>'
 * Jamais entre 15:30 et 18:30 UTC.
 */
import { writeFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';

const debutUtc = new Date();
const minutes = debutUtc.getUTCHours() * 60 + debutUtc.getUTCMinutes();
if (minutes >= 15 * 60 + 30 && minutes < 18 * 60 + 30) throw new Error('garde : aucune lecture de production entre 15:30 et 18:30 UTC');

const brute = new URL(process.env.DATABASE_URL ?? '');
brute.searchParams.set('options', '-c default_transaction_read_only=on -c statement_timeout=60000');
const client = new PrismaClient({ datasources: { db: { url: brute.toString() } } });
const [{ ro }] = await client.$queryRawUnsafe<{ ro: string }[]>(`SELECT current_setting('transaction_read_only') ro`);
if (ro !== 'on') throw new Error('garde : la session n’est pas en lecture seule');
const [{ n: colonne }] = await client.$queryRawUnsafe<{ n: number }[]>(
  `SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'JobSource' AND column_name = 'availabilityHold'`);

const RETENUE = 'AND available_source."availabilityHold" IS NULL';
const sansRetenue = (s: string) => (colonne ? s : s.split(RETENUE).join('AND true'));
const MARQUE = 'WITH base AS MATERIALIZED';
class Capturee extends Error {}
let executee: unknown;
const lire = client.$queryRaw.bind(client);
(client as unknown as { $queryRaw: unknown }).$queryRaw = async (requete: unknown, ...valeurs: unknown[]) => {
  const sql = requete as { strings?: readonly string[]; values?: readonly unknown[] };
  const texte = Array.isArray(requete) ? requete.join('') : sql.strings?.join('') ?? '';
  if (!/^\s*(SELECT|WITH)\b/i.test(texte)) throw new Error(`Lecture seule : requête refusée ${texte.slice(0, 60)}`);
  if (!sql.strings || !sql.values) return (lire as (...a: unknown[]) => unknown)(requete, ...valeurs);
  const reecrite = Prisma.sql(sql.strings.map(sansRetenue), ...(sql.values as unknown[]));
  if (texte.includes(MARQUE)) {
    executee = await lire(reecrite);
    throw new Capturee();
  }
  return lire(reecrite);
};
for (const m of ['$executeRaw', '$executeRawUnsafe', '$transaction'] as const) {
  (client as unknown as Record<string, unknown>)[m] = () => { throw new Error(`Lecture seule : ${m} refusé`); };
}
(globalThis as unknown as { prisma: PrismaClient }).prisma = client;
const jobs = await import(`${process.env.CODE_ROOT}/apps/api/lib/jobs.ts`);
const { CODES_MARCHE, MARCHES } = await import(`${process.env.CODE_ROOT}/packages/db/marches.ts`);

type Brut = { total: number; totalConfirmes: number; facettes: Record<string, { value: string; count: number }[]> };
async function servir(marche: string, filtres: Record<string, string[]>, section?: 'inconnues'): Promise<Brut> {
  executee = undefined;
  try {
    await jobs.getJobs({ marche, filtres, proximite: true, comprendre: true, fraicheur: true, nonPrecisees: true, ...(section ? { section } : {}) });
  } catch (erreur) {
    if (!executee) throw erreur;
  }
  if (!executee) throw new Error('requête servie non capturée');
  return (executee as Brut[])[0];
}

const [sortie] = process.argv.slice(2);
const lignes: { marche: string; filtre: string; valeur: string; total: number; totalConfirmes: number; ms: number; section?: number }[] = [];
/** `SECTION=1` (code d'après seulement) : la section des inconnues de chaque recherche, servie à part (arbitrage du 02/10). */
const SECTION = process.env.SECTION === '1';
const marches: { marche: string; servies: number; secteurInconnu: number; langueInconnue: number; facettesServies: string[] }[] = [];
for (const marche of CODES_MARCHE as string[]) {
  const nu = await servir(marche, {});
  const secteurs = (nu.facettes.secteur ?? []).filter((f) => f.value !== 'unclassified');
  const langues = nu.facettes.langue ?? [];
  const inconnu = (nu.facettes.secteur ?? []).find((f) => f.value === 'unclassified')?.count ?? 0;
  marches.push({ marche, servies: nu.total, secteurInconnu: inconnu,
    langueInconnue: nu.total - langues.reduce((n, f) => n + f.count, 0), facettesServies: [...MARCHES[marche].facettesSite] });
  // Un filtre que le marché ne sert pas est refusé par le plan : il n'est pas mesuré.
  const servis = new Set<string>(MARCHES[marche].facettesSite);
  for (const [filtre, valeurs] of ([['secteur', secteurs], ['langue', langues]] as const).filter(([f]) => servis.has(f))) {
    for (const v of valeurs) {
      const debut = Date.now();
      const r = await servir(marche, { [filtre]: [v.value] });
      const section = SECTION ? (await servir(marche, { [filtre]: [v.value] }, 'inconnues')).total : undefined;
      lignes.push({ marche, filtre, valeur: v.value, total: r.total, totalConfirmes: r.totalConfirmes, ms: Date.now() - debut, ...(section === undefined ? {} : { section }) });
    }
  }
  console.log(`${marche} : ${nu.total} servies, ${secteurs.length} secteurs, ${langues.length} langues`);
}
writeFileSync(sortie, JSON.stringify({ code: process.env.CODE_ROOT, colonneRetenue: !!colonne, debut: debutUtc.toISOString(), fin: new Date().toISOString(), marches, lignes }, null, 1));
console.log(`${lignes.length} recherches → ${sortie}`);
await client.$disconnect();
process.exit(0);
