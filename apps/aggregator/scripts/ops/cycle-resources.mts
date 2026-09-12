/**
 * CE QU'UN CYCLE A COÛTÉ — mesuré sur les événements du run, jamais estimé.
 *
 * Un cycle qu'on ne sait pas chiffrer ne se planifie pas : on ignore s'il tiendra à 9 sources, à 50, ou dans
 * une fenêtre de cron. Ce programme lit ce que le pipeline a RÉELLEMENT enregistré — bornes du run, bornes par
 * source, compteurs, erreurs, écritures — et refuse de combler les trous.
 *
 * Ce qu'il ne prétend PAS mesurer : la mémoire et les connexions Postgres du conteneur. Elles ne sont pas
 * enregistrées par le pipeline, et les lire ici, depuis un autre hôte, décrirait CE poste, pas le run
 * (l'egress d'un conteneur voisin n'est pas celui du cron — l'erreur de D32). Elles sont donc rendues
 * `null` avec leur motif, plutôt qu'inventées plausibles.
 *
 * usage: db.py readonly npx tsx scripts/ops/cycle-resources.mts --run-id=<id>
 */
import { PrismaClient, Prisma } from '@prisma/client';

const arg = (n: string) => process.argv.slice(2).find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const runId = arg('run-id');
if (!runId) {
  console.error('usage: cycle-resources.mts --run-id=<id>');
  process.exit(2);
}

const prisma = new PrismaClient();

const run = await prisma.pipelineRun.findUnique({
  where: { id: runId },
  select: { id: true, command: true, status: true, startedAt: true, finishedAt: true, revision: true, metrics: true },
});
if (!run) {
  console.error(`run introuvable : ${runId}`);
  process.exit(1);
}

const wallMs = run.finishedAt && run.startedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null;

/**
 * Les bornes PAR SOURCE : début et fin lus sur les événements, donc le temps réellement passé par source.
 *
 * Les noms d'événements sont ceux que le pipeline émet RÉELLEMENT, relevés sur un run : `source_sync_started`
 * et `source_sync_completed`, en tirets bas. La première version de ce programme interrogeait
 * `source.started` / `source.completed` — des noms plausibles qui n'existent pas — et rendait donc des durées
 * `null` sans jamais se plaindre. Une requête qui ne ramène rien n'est pas une mesure de zéro.
 */
const perSource: any[] = await prisma.$queryRaw(Prisma.sql`
  SELECT "sourceKey",
         min(at) FILTER (WHERE event IN ('source_sync_started','source.started')) AS started,
         max(at) FILTER (WHERE event IN ('source_sync_completed','source.completed','source.failed','source.timed_out','source.challenged')) AS ended,
         count(*) FILTER (WHERE event = 'source.rows_rejected')   AS rejected_events,
         count(*) FILTER (WHERE event = 'job.write_failed')       AS write_failed,
         count(*) FILTER (WHERE event = 'job.publication_held')   AS held,
         count(*) FILTER (WHERE level = 'error')                  AS errors
  FROM "PipelineEvent"
  WHERE "runId" = ${runId} AND "sourceKey" IS NOT NULL
  GROUP BY "sourceKey" ORDER BY "sourceKey"`);

/** Ce qui a été ÉCRIT pendant ce cycle : les représentations ré-attestées, par source. */
const written: any[] = await prisma.$queryRaw(Prisma.sql`
  SELECT sr."sourceKey", sr.fetched, sr.accepted, sr."declaredTotal", sr.errors, sr.truncated, sr.status
  FROM "SourceRun" sr WHERE sr."runId" = ${runId} ORDER BY sr."sourceKey"`);

const byKey = new Map(written.map((w) => [w.sourceKey, w]));
const sources = perSource.map((s) => {
  const durationMs = s.started && s.ended ? new Date(s.ended).getTime() - new Date(s.started).getTime() : null;
  const w = byKey.get(s.sourceKey);
  return {
    sourceKey: s.sourceKey,
    durationMs,
    fetched: w?.fetched ?? null,
    accepted: w?.accepted ?? null,
    declaredTotal: w?.declaredTotal ?? null,
    status: w?.status ?? null,
    truncated: w?.truncated ?? null,
    // Le débit n'a de sens que si les deux grandeurs existent : sinon `null`, jamais 0.
    offersPerSecond: durationMs && durationMs > 0 && w?.fetched != null
      ? Number((w.fetched / (durationMs / 1000)).toFixed(2)) : null,
    errors: Number(s.errors ?? 0),
    writeFailed: Number(s.write_failed ?? 0),
    held: Number(s.held ?? 0),
    rejectedEvents: Number(s.rejected_events ?? 0),
  };
});

const totalFetched = sources.reduce((a, s) => a + (s.fetched ?? 0), 0);

/**
 * Une mesure absente doit se VOIR. Si aucune source n'a de bornes alors que le run en a traité, la requête
 * ne correspond plus aux événements émis — c'est le défaut qui a produit des `null` silencieux — et il faut
 * le dire au lieu de rendre un rapport d'apparence complète.
 */
const measured = sources.filter((s) => s.durationMs != null).length;
const measurementWarning = sources.length > 0 && measured === 0
  ? 'AUCUNE borne par source trouvée : les noms d\'événements interrogés ne correspondent pas à ceux émis'
  : null;

console.log(JSON.stringify({
  run: {
    id: run.id, command: run.command, status: run.status, revision: run.revision,
    startedAt: run.startedAt?.toISOString(), finishedAt: run.finishedAt?.toISOString(),
    wallMs, wallHuman: wallMs != null ? `${(wallMs / 1000).toFixed(1)}s` : null,
  },
  sources,
  totals: {
    sources: sources.length,
    fetched: totalFetched,
    errors: sources.reduce((a, s) => a + s.errors, 0),
    writeFailed: sources.reduce((a, s) => a + s.writeFailed, 0),
    held: sources.reduce((a, s) => a + s.held, 0),
    offersPerSecond: wallMs && wallMs > 0 ? Number((totalFetched / (wallMs / 1000)).toFixed(2)) : null,
  },
  notMeasured: {
    memory: 'non enregistré par le pipeline ; le lire ici décrirait cet hôte, pas le conteneur du run',
    dbConnections: 'idem — la mesure doit venir du processus réel (leçon D32)',
  },
  measurementWarning,
  metrics: run.metrics ?? null,
}, null, 1));

await prisma.$disconnect();
