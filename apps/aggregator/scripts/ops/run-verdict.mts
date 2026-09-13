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
const strict = !process.argv.includes('--allow-command-lookup');
if (!runId && !command) {
  console.error('usage: run-verdict.mts (--run-id=<id> | --command=<nom>)');
  process.exit(2);
}
/**
 * FAIL-CLOSED : pour une mesure de capacité, l'identifiant exact est obligatoire. « Le dernier run portant ce
 * nom » est une heuristique qui cesse d'être vraie dès que deux passages se chevauchent — et c'est
 * précisément le moment où l'on croirait mesurer l'un en lisant l'autre.
 */
if (!runId && strict) {
  const payload = {
    command, pipelineRunId: null, lookup: 'NONE', validForCapacity: false,
    pipelineRunStatus: null, invalidatedReason: 'RUN_ID_NOT_CAPTURED',
    problems: ['PIPELINE_RUN_ID_NOT_CAPTURED'], exitCode: 1, sourceRuns: [],
  };
  const o = arg('out'); if (o) writeFileSync(o, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify(payload, null, 1));
  process.exit(1);
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
if (run && expectCommit) {
  if (!run.revision) {
    // Une révision absente ne prouve rien : la traiter comme conforme serait un succès silencieux.
    identityProblems.push('PIPELINE_RUN_REVISION_MISSING');
  } else if (run.revision !== expectCommit) {
    identityProblems.push(`PIPELINE_RUN_IDENTITY_MISMATCH:commit:${run.revision.slice(0, 8)}≠${expectCommit.slice(0, 8)}`);
  }
}

/**
 * 3. LE PÉRIMÈTRE DES SOURCERUN — lire tous les SourceRun présents ne dit pas que toutes les sources demandées
 * ont tourné. Un PipelineRun COMPLETED avec 17 SourceRun sur un corpus de 18 n'est pas une mesure valide.
 */
const expectedKeys = (arg('expect-sources') ?? '').split(',').map((k) => k.trim()).filter(Boolean);

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
let missingSourceKeys: string[] = [];
let unexpectedSourceKeys: string[] = [];
let duplicateSourceKeys: string[] = [];
if (expectedKeys.length) {
  const actual = sourceRuns.map((s) => s.sourceKey);
  const actualSet = new Set(actual);
  missingSourceKeys = expectedKeys.filter((k) => !actualSet.has(k));
  unexpectedSourceKeys = [...actualSet].filter((k) => !expectedKeys.includes(k));
  duplicateSourceKeys = [...new Set(actual.filter((k, i) => actual.indexOf(k) !== i))];
  if (missingSourceKeys.length) identityProblems.push(`SOURCE_RUN_MISSING:${missingSourceKeys.join(',')}`);
  if (unexpectedSourceKeys.length) identityProblems.push(`SOURCE_RUN_UNEXPECTED:${unexpectedSourceKeys.join(',')}`);
  if (duplicateSourceKeys.length) identityProblems.push(`SOURCE_RUN_DUPLICATE:${duplicateSourceKeys.join(',')}`);
}

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
  expectedSourceKeys: expectedKeys,
  actualSourceRunKeys: sourceRuns.map((s) => s.sourceKey),
  missingSourceKeys, unexpectedSourceKeys, duplicateSourceKeys,
  ...verdict,
};
if (out) writeFileSync(out, JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload, null, 1));
await prisma.$disconnect();
process.exit(verdict.exitCode);
