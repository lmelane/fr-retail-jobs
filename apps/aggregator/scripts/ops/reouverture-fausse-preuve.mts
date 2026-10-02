/**
 * D-520 §4 a — RÉPARER LES FERMETURES ET RETENUES POSÉES SUR UNE FAUSSE PREUVE DE LISTE COMPLÈTE (knitwell-us-retail,
 * 23-30/09/2026), en deux temps, par le mécanisme existant de réouverture : la collecte native (`reouverture.ts`).
 *
 * Aperçu, lecture seule (la liste est relue en direct, liste seule, aucune fiche ni écriture) :
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx apps/aggregator/scripts/ops/reouverture-fausse-preuve.mts \
 *     knitwell-us-retail --depuis=2026-09-23 --output=<aperçu.json>
 * Application, avec la release (code de D-520 §4 a livré), hors fenêtre du RUN (15:30-18:30 UTC) et hors RUN :
 *   python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/scripts/ops/reouverture-fausse-preuve.mts \
 *     knitwell-us-retail --apply --plan=<aperçu relu>
 *
 * L'aperçu refuse sans liste PROUVÉE complète (preuve par facette de D-520 §4 a). L'application refuse, sans rien écrire,
 * si les représentations fermées ou retenues ont changé depuis l'aperçu (REVIEWED_PLAN_MISMATCH : refaire l'aperçu), puis
 * lance `verifier-source` (la collecte native du RUN, qui revoit et rouvre), puis vérifie que cette collecte est une
 * preuve complète et que chaque ligne `aRouvrir` revue est rouverte. Code de sortie 1 sinon. Même environnement que
 * toute collecte (stockage des captures).
 */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchWorkdayJobs } from '../../src/ats/adapters/workday.js';
import { PROVING_TERMINATIONS } from '../../src/pipeline/refreshPlan.js';
import { lightPassRefusal, runningRuns } from '../../src/pipeline/lightPass.js';
import { checkReopening, planReopening, planStillHolds, type AfterState, type ReopeningPlan, type Representation } from './reouverture.js';

const key = process.argv[2];
const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = process.argv.includes('--apply');
if (!key || key.startsWith('--') || (apply ? !arg('plan') || arg('output') : !!arg('plan'))) {
  console.error('usage: reouverture-fausse-preuve.mts <clé> [--depuis=AAAA-MM-JJ] [--output=<aperçu.json>] | <clé> --apply --plan=<aperçu relu>');
  process.exit(2);
}
const prisma = new PrismaClient();

async function representations(sourceKey: string, since: Date): Promise<Representation[]> {
  const closed = await prisma.jobSource.findMany({ where: { sourceKey, isActive: false, publisherClosedAt: { gte: since } },
    select: { id: true, jobId: true, externalId: true, publisherClosedAt: true } });
  const held = await prisma.jobSource.findMany({ where: { sourceKey, isActive: true, availabilityHold: 'NOT_RECONFIRMED', availabilityHoldAt: { gte: since } },
    select: { id: true, jobId: true, externalId: true, availabilityHoldAt: true, availabilityEvidence: true } });
  return [
    ...closed.map((r): Representation => ({ jobSourceId: r.id, jobId: r.jobId, externalId: r.externalId, etat: 'FERMEE', depuis: r.publisherClosedAt!.toISOString(), regle: null })),
    ...held.map((r): Representation => ({ jobSourceId: r.id, jobId: r.jobId, externalId: r.externalId, etat: 'RETENUE', depuis: r.availabilityHoldAt!.toISOString(),
      regle: String((r.availabilityEvidence as { rule?: unknown } | null)?.rule ?? '') || null })),
  ];
}

async function guard(): Promise<void> {
  const refused = lightPassRefusal(new Date(), await runningRuns(prisma, null));
  if (refused) throw new Error(`REFUSED: ${refused} (hors fenêtre du RUN 15:30-18:30 UTC, et jamais pendant un RUN ou une passe)`);
}

async function preview(): Promise<void> {
  await guard();
  const since = new Date(`${arg('depuis') ?? '2026-09-23'}T00:00:00Z`);
  if (Number.isNaN(since.getTime())) throw new Error('--depuis=AAAA-MM-JJ');
  const source = await prisma.source.findUniqueOrThrow({ where: { key }, select: { kind: true, config: true, status: true } });
  if (source.kind !== 'workday') throw new Error(`source ${key} : famille ${source.kind}, cette réparation ne lit que Workday`);
  const at = new Date().toISOString();
  const read = await fetchWorkdayJobs({ ...(source.config as Record<string, unknown>), withDescriptions: false });
  const termination = read.enumeration?.termination ?? null;
  const proof = { at, complete: read.complete === true && !!termination && PROVING_TERMINATIONS.has(termination) && read.enumeration?.canonicalAbsenceProofUsable !== false,
    termination, declaredTotal: read.declaredTotal ?? null, listed: read.jobs.map(job => job.externalId) };
  const plan = planReopening({ sourceKey: key!, since: since.toISOString(), rows: await representations(key!, since), proof });
  const output = arg('output');
  if (output) writeFileSync(output, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ok: true, mode: 'aperçu', sourceKey: key, status: source.status, preuve: plan.preuve,
    issues: read.enumeration?.issues ?? [], aRouvrir: plan.aRouvrir.length, resteFermees: plan.resteFermees.length,
    parEtat: Object.fromEntries(['FERMEE', 'RETENUE'].map(e => [e, plan.aRouvrir.filter(r => r.etat === e).length])),
    empreinte: plan.empreinte, output: output ?? null }, null, 2));
}

async function application(): Promise<void> {
  const plan = JSON.parse(readFileSync(arg('plan')!, 'utf8')) as ReopeningPlan;
  if (plan.sourceKey !== key) throw new Error(`REVIEWED_PLAN_MISMATCH: le plan relu porte sur ${plan.sourceKey}`);
  await guard();
  if (!planStillHolds(plan, await representations(key!, new Date(plan.since))))
    throw new Error('REVIEWED_PLAN_MISMATCH: les représentations fermées ou retenues ont changé depuis l\'aperçu ; refaire l\'aperçu et le relire');
  const started = new Date();
  // Le mécanisme existant : la collecte native de la source (ce que fait le RUN), qui revoit chaque offre listée et la rouvre.
  const verifier = spawnSync('npx', ['tsx', 'src/cli.ts', 'verifier-source', key!], { stdio: 'inherit', env: process.env,
    cwd: fileURLToPath(new URL('../../', import.meta.url)) });
  const run = await prisma.sourceRun.findFirst({ where: { sourceKey: key, ranAt: { gte: started } }, orderBy: { ranAt: 'desc' },
    select: { ranAt: true, status: true, jobs: true, fetched: true, declaredTotal: true, complete: true, canAttestAbsence: true, note: true } });
  const rows = await prisma.jobSource.findMany({ where: { id: { in: plan.aRouvrir.map(r => r.jobSourceId) } },
    select: { id: true, isActive: true, publisherClosedAt: true, availabilityHold: true, lastSeenAt: true, job: { select: { isActive: true } } } });
  const after = new Map(rows.map((r): [string, AfterState] => [r.id, { jobSourceId: r.id, isActive: r.isActive, publisherClosedAt: r.publisherClosedAt?.toISOString() ?? null,
    availabilityHold: r.availabilityHold, lastSeenAt: r.lastSeenAt.toISOString(), jobActive: r.job?.isActive ?? null }]));
  const check = checkReopening(plan, after, started);
  // La preuve : la collecte de la réparation est elle-même une liste prouvée complète.
  const proven = run?.complete === true && run.canAttestAbsence === true;
  const ok = proven && check.nonRouvertes.length === 0;
  console.log(JSON.stringify({ ok, mode: 'application', sourceKey: key, verifierExit: verifier.status, collecte: run, preuveComplete: proven,
    aRouvrir: plan.aRouvrir.length, rouvertes: check.rouvertes.length, nonRevues: check.nonRevues, nonRouvertes: check.nonRouvertes }, null, 2));
  if (!ok) process.exitCode = 1;
}

try { await (apply ? application() : preview()); }
catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
