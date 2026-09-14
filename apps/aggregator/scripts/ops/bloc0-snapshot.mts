/**
 * LA PHOTOGRAPHIE TERMINALE DE DÉPART — une seule transaction REPEATABLE READ, en lecture seule.
 *
 * Pourquoi REPEATABLE READ et non le défaut : en READ COMMITTED, chaque requête voit un instantané DIFFÉRENT
 * (mesuré en P2). Compter les offres puis les sources dans deux instantanés produit un état qui n'a jamais
 * existé — et c'est précisément ce genre d'incohérence qu'une photographie de référence doit exclure, puisque
 * tout écart ultérieur y sera comparé.
 *
 * La transaction est aussi déclarée READ ONLY : la garantie ne repose pas sur l'intention de l'appelant mais
 * sur le moteur, qui refusera toute écriture.
 *
 * Les grandeurs sont SÉPARÉES parce qu'elles ne mesurent pas la même chose :
 *   · offres actives          `Job.isActive` — ce que le catalogue publie
 *   · représentations actives `JobSource` active dont le Job est actif — une offre peut en porter plusieurs
 *   · offres sans source vivante  une offre publiée que plus aucune source n'atteste : anomalie de cycle de vie
 *   · offres retenues         collectées et délibérément non publiées (revue d'identité, hors périmètre)
 *
 * usage: db.py readonly npx tsx scripts/ops/bloc0-snapshot.mts [--out=<f.json>]
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const p = new PrismaClient();

type Row = Record<string, any>;
const n = (r: Row[], k = 'n') => Number(r[0]?.[k] ?? 0);

const photo = await p.$transaction(async (tx) => {
  // L'ordre importe : le niveau d'isolation doit être posé avant la première lecture de la transaction.
  await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  const at = await tx.$queryRawUnsafe<Row[]>('SELECT now() at, pg_backend_pid() pid');

  const sources = await tx.$queryRawUnsafe<Row[]>(
    `SELECT status, COUNT(*)::int n FROM "Source" GROUP BY 1 ORDER BY 1`);

  /**
   * Certifiée = sa revue d'identité LA PLUS RÉCENTE est VERIFIED.
   * Ne pas filtrer sur `verdict='VERIFIED'` directement : une contradiction postérieure ressusciterait
   * une vérification invalidée (règle gravée dans `requireSourceIdentity`).
   */
  const certified = await tx.$queryRawUnsafe<Row[]>(
    `SELECT s.status, COUNT(*)::int n FROM "Source" s
     WHERE (SELECT r.verdict FROM "SourceIdentityReview" r WHERE r."sourceKey" = s.key
            ORDER BY r."createdAt" DESC, r.id DESC LIMIT 1) = 'VERIFIED'
     GROUP BY 1 ORDER BY 1`);

  const jobs = await tx.$queryRawUnsafe<Row[]>(
    `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE "isActive")::int actives,
            COUNT(*) FILTER (WHERE NOT "isActive")::int fermees,
            COUNT(*) FILTER (WHERE "isActive" AND "closedAt" IS NOT NULL)::int activesAvecClosedAt
     FROM "Job"`);

  const reps = await tx.$queryRawUnsafe<Row[]>(
    `SELECT COUNT(*)::int total,
            COUNT(*) FILTER (WHERE js."isActive" AND j."isActive")::int actives
     FROM "JobSource" js JOIN "Job" j ON j.id = js."jobId"`);

  // Une offre active que plus AUCUNE attestation active ne soutient : elle ne devrait pas être publiée.
  const orphans = await tx.$queryRawUnsafe<Row[]>(
    `SELECT COUNT(*)::int n FROM "Job" j WHERE j."isActive" AND NOT EXISTS (
       SELECT 1 FROM "JobSource" js WHERE js."jobId" = j.id AND js."isActive")`);

  const held = await tx.$queryRawUnsafe<Row[]>(
    `SELECT COUNT(*)::int n FROM "PipelineEvent" WHERE event = 'job.publication_held'`);

  /**
   * « En cours » se définit par les statuts TERMINAUX réellement présents, pas par une liste devinée.
   * Mesuré : `COMPLETED`, `COMPLETED_WITH_ERRORS` et `INTERRUPTED` — les trois sont terminaux.
   * `COMPLETED_WITH_ERRORS` dit qu'un run s'est terminé en ayant rencontré des erreurs de source ; le lire
   * comme « en vol » ferait croire à dix exécutions pendantes qui sont toutes finies depuis des jours.
   */
  const TERMINAUX = ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'INTERRUPTED', 'FAILED'];
  const runsInFlight = await tx.$queryRawUnsafe<Row[]>(
    `SELECT id, status, "startedAt", command FROM "PipelineRun"
     WHERE status <> ALL($1::text[]) ORDER BY "startedAt" DESC LIMIT 10`, TERMINAUX);
  const runsParStatut = await tx.$queryRawUnsafe<Row[]>(
    `SELECT status, COUNT(*)::int n, MAX("startedAt") dernier FROM "PipelineRun" GROUP BY 1 ORDER BY 2 DESC`);

  const lastRunPerSource = await tx.$queryRawUnsafe<Row[]>(
    `SELECT COUNT(*)::int sourcesAvecRun,
            COUNT(*) FILTER (WHERE age > INTERVAL '7 days')::int plusDe7Jours,
            MIN(age)::text plusRecent, MAX(age)::text plusAncien
     FROM (SELECT sr."sourceKey", now() - MAX(sr."ranAt") age FROM "SourceRun" sr GROUP BY 1) t`);

  const obs = await tx.$queryRawUnsafe<Row[]>(
    `SELECT COUNT(*)::int lignes, MIN("observedAt") plusAncienne, MAX("observedAt") plusRecente,
            COUNT(DISTINCT "sourceKey")::int sources, COUNT(DISTINCT "contentHash")::int empreintes
     FROM "SourceObservation"`);

  const dbSize = await tx.$queryRawUnsafe<Row[]>(
    `SELECT pg_database_size(current_database())::bigint octets,
            pg_size_pretty(pg_database_size(current_database())) lisible`);

  const tables = await tx.$queryRawUnsafe<Row[]>(
    `SELECT relname tableName, pg_total_relation_size(c.oid)::bigint octets,
            pg_size_pretty(pg_total_relation_size(c.oid)) lisible
     FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'r'
     ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 8`);

  const archives = await tx.$queryRawUnsafe<Row[]>(
    `SELECT COUNT(*)::int pointeurs FROM "ObservationArchiveRef"`);

  return {
    at: at[0].at, backendPid: Number(at[0].pid),
    isolation: 'REPEATABLE READ, READ ONLY',
    sources: {
      total: sources.reduce((s, r) => s + Number(r.n), 0),
      parStatut: Object.fromEntries(sources.map((r) => [r.status, Number(r.n)])),
      certifieesParStatut: Object.fromEntries(certified.map((r) => [r.status, Number(r.n)])),
      certifieesTotal: certified.reduce((s, r) => s + Number(r.n), 0),
    },
    offres: {
      total: n(jobs, 'total'), actives: n(jobs, 'actives'), fermees: n(jobs, 'fermees'),
      activesAvecClosedAt: n(jobs, 'activesavecclosedat'),
      sansSourceVivante: n(orphans), retenuesHistorique: n(held),
    },
    representations: { total: n(reps, 'total'), actives: n(reps, 'actives') },
    runsEnCours: runsInFlight, runsParStatut,
    collecte: lastRunPerSource[0],
    observations: obs[0],
    stockage: { base: dbSize[0], tables },
    archivesDistantes: n(archives, 'pointeurs'),
  };
});
await p.$disconnect();

const json = JSON.stringify(photo, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 1);
if (out) { writeFileSync(out, json); console.error(`photographie écrite : ${out}`); }
console.log(json);
