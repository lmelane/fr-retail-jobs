/**
 * LE VERDICT TERMINAL d'un passage borné, lu en base — appelé par le runner avant de conclure.
 *
 * Le runner savait dire que SA chaîne s'était déroulée ; il ne lisait pas l'état du travail piloté. Un
 * `PipelineRun` INTERRUPTED passait donc pour un succès. Ce programme comble exactement cet écart : il lit le
 * statut terminal réel et les SourceRun du run, et rend le verdict de recevabilité comme MESURE.
 *
 * L'identité du run se prouve par son IDENTIFIANT, pas par son nom. Chercher « le dernier run portant ce
 * nom » marche tant que rien ne se chevauche — et cesse de marcher exactement quand on en aurait besoin. Le
 * `--run-id` est donc la preuve principale ; le nom n'est qu'un repli de diagnostic, et tout écart sur le
 * commit ou le nom est un refus.
 *
 * usage: db.py readonly npx tsx scripts/ops/run-verdict.mts
 *          (--run-id=<id> | --command=<nom>) [--expect-command=<nom>] [--expect-commit=<sha>]
 *          [--allow-with-errors] [--out=<f.json>]
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { capacityVerdict, type SourceRunFact } from '../../src/ops/runTerminalVerdict.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const runId = arg('run-id');
const command = arg('command');
const expectCommand = arg('expect-command') ?? command;
const expectCommit = arg('expect-commit');
if (!runId && !command) {
  console.error('usage: run-verdict.mts (--run-id=<id> | --command=<nom>)');
  process.exit(2);
}

const prisma = new PrismaClient();
const run = runId
  ? await prisma.pipelineRun.findUnique({
      where: { id: runId },
      select: { id: true, status: true, startedAt: true, finishedAt: true, command: true, revision: true },
    })
  : await prisma.pipelineRun.findFirst({
      where: { command: command! }, orderBy: { startedAt: 'desc' },
      select: { id: true, status: true, startedAt: true, finishedAt: true, command: true, revision: true },
    });

/**
 * L'identité croisée : un run trouvé n'est pas forcément CELUI qu'on a lancé. Comparer le nom et le commit
 * empêche de conclure sur le run d'un autre passage — un faux positif d'autant plus dangereux qu'il
 * ressemblerait à un succès.
 */
const identityProblems: string[] = [];
if (run && expectCommand && run.command !== expectCommand) {
  identityProblems.push(`PIPELINE_RUN_IDENTITY_MISMATCH:command:${run.command}≠${expectCommand}`);
}
if (run && expectCommit && run.revision && run.revision !== expectCommit) {
  identityProblems.push(`PIPELINE_RUN_IDENTITY_MISMATCH:commit:${run.revision.slice(0, 8)}≠${expectCommit.slice(0, 8)}`);
}

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
  environmentProblems: identityProblems,
  allowWithErrors: process.argv.includes('--allow-with-errors'),
});

const out = arg('out');
const payload = {
  command: run?.command ?? command ?? null,
  pipelineRunId: run?.id ?? null,
  requestedRunId: runId ?? null,
  lookup: runId ? 'BY_ID' : 'BY_COMMAND_FALLBACK',
  revision: run?.revision ?? null,
  startedAt: run?.startedAt?.toISOString() ?? null,
  finishedAt: run?.finishedAt?.toISOString() ?? null,
  sourceRuns,
  ...verdict,
};
if (out) writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload, null, 1));
await prisma.$disconnect();
process.exit(verdict.exitCode);
