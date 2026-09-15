/** Read-only preview of the exact planner used by runRefresh.
 * Usage: refresh-preview.mts --keys=<k1,k2> [--out=<file.json>] [--manifest-out=<file.json>]
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { readRefreshPlan, refreshScope, createRefreshManifest } from '../../src/pipeline/refresh.js';

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
if (arg('keys') === undefined) throw new Error('refresh-preview requires --keys=<source keys>');
const db = new PrismaClient({ log: [] });
try {
  const catalogue = await db.source.findMany({ select: { key: true } });
  const requested = refreshScope(catalogue.map(source => source.key), arg('keys'))!;
  const plan = await readRefreshPlan(db, { onlyKeys: requested });
  const { absencePlan } = plan;
  const states: Record<string, number> = {};
  const unverifiable: Record<string, number> = {};
  for (const rep of absencePlan.representations) {
    const state = absencePlan.states.get(rep.jobSourceId)!;
    states[state] = (states[state] ?? 0) + 1;
    if (state === 'UNVERIFIABLE') unverifiable[rep.sourceKey] = (unverifiable[rep.sourceKey] ?? 0) + 1;
  }
  const eligible = absencePlan.eligibility.filter(source => source.eligible).map(source => source.source);
  const closures = plan.wouldClose.filter(id => !plan.orphans.some(job => job.id === id));
  const affected = await db.job.findMany({ where: { id: { in: [...new Set(plan.staleSources.flatMap(source => source.jobId ? [source.jobId] : []))] } }, select: { id: true, isActive: true } });
  const closing = new Set(closures);
  const kept = affected.filter(job => job.isActive && !closing.has(job.id)).map(job => job.id);
  const manifest = plan.refused ? null : await createRefreshManifest(db, plan);
  const preview = {
    at: plan.asOf, cutoff: plan.cutoff, requested, eligible, eligibility: absencePlan.eligibility,
    representationStates: states, perimeterLiveJobs: plan.liveTotal,
    plannedDeactivations: plan.staleSources,
    frozenManifest: manifest,
    jobsKeptByAnotherSource: kept, jobsCandidateForClosure: closures,
    jobsAlreadyInactive: affected.filter(job => !job.isActive).map(job => job.id),
    administrativeWithdrawals: plan.orphans.map(job => job.id),
    reopenings: plan.revived.map(job => ({ jobId: job.id, closedAt: job.closedAt, withdrawnAt: job.withdrawnAt })),
    unverifiable, heldSeen: states.PRESENT_BUT_HELD ?? 0, writeFailedSeen: states.PRESENT_BUT_WRITE_FAILED ?? 0,
    guards: { refused: plan.refused, closureRatioPct: plan.liveTotal ? 100 * plan.wouldClose.length / plan.liveTotal : 0,
      limits: plan.limits,
      ineligible: absencePlan.eligibility.filter(source => !source.eligible) },
  };
  const serialized = JSON.stringify(preview, null, 2);
  const out = arg('out');
  if (out) writeFileSync(out, serialized + '\n');
  if (arg('manifest-out')) {
    if (!manifest) throw new Error('Cannot freeze a refused refresh plan');
    writeFileSync(arg('manifest-out')!, JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log(serialized);
} finally {
  await db.$disconnect();
}
