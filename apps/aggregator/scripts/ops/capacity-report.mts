/**
 * LE RAPPORT DE CAPACITÉ D'UNE PASSE — tout ce qu'un run a coûté, lu sur ce qu'il a enregistré.
 *
 * P8 demande de dire où passent le temps, les requêtes, la mémoire, les connexions et les écritures. Ce
 * programme ne mesure rien lui-même : il LIT ce que le run a écrit depuis l'intérieur du conteneur, et il
 * refuse de compléter ce qui manque. Une grandeur absente est rendue `null` avec son motif — c'est la seule
 * façon de distinguer « mesuré à zéro » de « pas mesuré », deux verdicts que rien ne rapproche.
 *
 * usage: db.py readonly npx tsx scripts/ops/capacity-report.mts --run-id=<id> [--out=<f.json>]
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const runId = arg('run-id');
if (!runId) { console.error('usage: capacity-report.mts --run-id=<id> [--out=…]'); process.exit(2); }

const prisma = new PrismaClient();

const run = await prisma.pipelineRun.findUnique({
  where: { id: runId },
  select: { id: true, command: true, status: true, startedAt: true, finishedAt: true, revision: true, metrics: true },
});
if (!run) { console.error(`run introuvable : ${runId}`); process.exit(1); }

const m: any = run.metrics ?? {};
const wallMs = run.finishedAt && run.startedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null;

/** Le temps réellement passé par source, borné par ses propres événements. */
const perSource: any[] = await prisma.$queryRaw(Prisma.sql`
  SELECT "sourceKey",
         min(at) FILTER (WHERE event = 'source_sync_started') AS started,
         max(at) FILTER (WHERE event IN ('source_sync_completed','source.failed','source.timed_out','source.challenged')) AS ended,
         count(*) FILTER (WHERE level = 'error') AS errors,
         count(*) FILTER (WHERE event = 'job.write_failed') AS write_failed,
         count(*) FILTER (WHERE event = 'job.publication_held') AS held,
         count(*) FILTER (WHERE event = 'source.rows_rejected') AS rejected
  FROM "PipelineEvent" WHERE "runId" = ${runId} AND "sourceKey" IS NOT NULL
  GROUP BY "sourceKey" ORDER BY "sourceKey"`);

const runs: any[] = await prisma.$queryRaw(Prisma.sql`
  SELECT "sourceKey", status, fetched, accepted, "declaredTotal", errors, truncated, complete, "canAttestAbsence"
  FROM "SourceRun" WHERE "runId" = ${runId} ORDER BY "sourceKey"`);
const byKey = new Map(runs.map((r) => [r.sourceKey, r]));

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
    complete: w?.complete ?? null,
    truncated: w?.truncated ?? null,
    offersPerSecond: durationMs && durationMs > 0 && w?.fetched != null
      ? Number((w.fetched / (durationMs / 1000)).toFixed(2)) : null,
    errors: Number(s.errors ?? 0),
    writeFailed: Number(s.write_failed ?? 0),
    held: Number(s.held ?? 0),
    rejected: Number(s.rejected ?? 0),
  };
});

/** Ce que le cycle a réellement écrit : créations et ré-attestations, distinguées par `firstSeenAt`. */
const written: any[] = await prisma.$queryRaw(Prisma.sql`
  SELECT js."sourceKey",
         count(*) FILTER (WHERE js."firstSeenAt" >= ${run.startedAt})::int AS created,
         count(*) FILTER (WHERE js."lastSeenAt" >= ${run.startedAt} AND js."firstSeenAt" < ${run.startedAt})::int AS reattested
  FROM "JobSource" js
  WHERE js."sourceKey" = ANY(${sources.map((s) => s.sourceKey)})
  GROUP BY js."sourceKey"`);
const writes = new Map(written.map((w) => [w.sourceKey, w]));
for (const s of sources) {
  (s as any).created = writes.get(s.sourceKey)?.created ?? 0;
  (s as any).reattested = writes.get(s.sourceKey)?.reattested ?? 0;
}

const totalFetched = sources.reduce((a, s) => a + (s.fetched ?? 0), 0);
const hosts: any[] = Array.isArray(m.httpByHost) ? m.httpByHost : [];

const report = {
  run: {
    id: run.id, command: run.command, status: run.status, revision: run.revision,
    startedAt: run.startedAt?.toISOString(), finishedAt: run.finishedAt?.toISOString(),
    wallMs, wallHuman: wallMs != null ? `${(wallMs / 1000).toFixed(1)}s` : null,
  },
  sources,
  totals: {
    sources: sources.length,
    fetched: totalFetched,
    created: sources.reduce((a, s) => a + ((s as any).created ?? 0), 0),
    reattested: sources.reduce((a, s) => a + ((s as any).reattested ?? 0), 0),
    errors: sources.reduce((a, s) => a + s.errors, 0),
    writeFailed: sources.reduce((a, s) => a + s.writeFailed, 0),
    held: sources.reduce((a, s) => a + s.held, 0),
    rejected: sources.reduce((a, s) => a + s.rejected, 0),
    offersPerSecond: wallMs && wallMs > 0 ? Number((totalFetched / (wallMs / 1000)).toFixed(2)) : null,
  },
  http: {
    counters: m.counters ?? {},
    byHost: hosts,
    // Absent = l'instrumentation n'était pas déployée pour ce run. Le dire, plutôt que rendre une liste vide
    // qu'on lirait comme « aucune requête ».
    unavailable: hosts.length ? undefined : 'httpByHost absent des métriques : instrumentation non déployée pour ce run',
  },
  resources: m.resources ?? { unavailable: 'bloc resources absent des métriques' },
  persistenceFailures: m.persistenceFailures ?? null,
};

const out = arg('out');
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
await prisma.$disconnect();
