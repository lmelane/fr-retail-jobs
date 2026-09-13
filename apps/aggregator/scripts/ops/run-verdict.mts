/**
 * LE VERDICT TERMINAL d'un passage borné, lu en base — appelé par le runner avant de conclure.
 *
 * Le runner savait dire que SA chaîne s'était déroulée ; il ne lisait pas l'état du travail piloté. Un
 * `PipelineRun` INTERRUPTED passait donc pour un succès. Ce programme comble exactement cet écart : il lit le
 * statut terminal réel et les SourceRun du run, et rend le verdict de recevabilité comme MESURE.
 *
 * usage: db.py readonly npx tsx scripts/ops/run-verdict.mts --command=<nom> [--allow-with-errors] [--out=<f.json>]
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { capacityVerdict, type SourceRunFact } from '../../src/ops/runTerminalVerdict.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const command = arg('command');
if (!command) { console.error('usage: run-verdict.mts --command=<nom>'); process.exit(2); }

const prisma = new PrismaClient();
const run = await prisma.pipelineRun.findFirst({
  where: { command }, orderBy: { startedAt: 'desc' },
  select: { id: true, status: true, startedAt: true, finishedAt: true },
});

let sourceRuns: SourceRunFact[] = [];
if (run) {
  const rows = await prisma.sourceRun.findMany({
    where: { runId: run.id },
    select: { sourceKey: true, status: true, complete: true, truncated: true, errors: true },
  });
  sourceRuns = rows.map((r) => ({
    sourceKey: r.sourceKey, status: r.status, complete: r.complete, truncated: r.truncated, errors: r.errors,
  }));
}

// Un run sans `finishedAt` n'est pas terminal, quel que soit son statut affiché.
const status = run ? (run.finishedAt ? (run.status as any) : 'RUNNING') : null;
const verdict = capacityVerdict({
  status, runFound: Boolean(run), sourceRuns,
  allowWithErrors: process.argv.includes('--allow-with-errors'),
});

const out = arg('out');
const payload = { command, runId: run?.id ?? null, ...verdict };
if (out) writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload, null, 1));
await prisma.$disconnect();
process.exit(verdict.exitCode);
