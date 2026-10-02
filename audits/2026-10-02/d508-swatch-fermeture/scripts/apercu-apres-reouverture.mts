/**
 * D-508 §6 — LE PASSAGE À BLANC À REJOUER APRÈS LA RÉOUVERTURE DE swatch-group, AVANT LE RUN QUI FERMERA.
 *
 * Lecture seule : `readRefreshPlan` est le planificateur exact de `runRefresh`, lu sans rien écrire. Il est borné à
 * swatch-group pour la LISTE, avec `maxCloseRatio: 1` : borné à 380 offres, 68 fermetures (17,9 %) dépasseraient les 5 %
 * de la garde, qui ne s'applique pourtant jamais à ce périmètre-là. La garde du RUN est recalculée à part, sur SON
 * périmètre (toutes les sources ACTIVE, `cli.ts` ingest-all) : c'est elle qui décidera ce soir-là.
 *
 * Lancer depuis la copie `code/` de la release :
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx audits/2026-10-02/d508-swatch-fermeture/scripts/apercu-apres-reouverture.mts
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { readRefreshPlan } from '../../../../apps/aggregator/src/pipeline/refresh.js';
import { REFRESH_LIMITS } from '../../../../apps/aggregator/src/pipeline/refreshManifest.js';

const KEY = 'swatch-group';
const db = new PrismaClient({ log: [] });
try {
  const plan = await readRefreshPlan(db, { onlyKeys: [KEY], maxCloseRatio: 1 });
  const eligibility = plan.absencePlan.eligibility.find((row) => row.source === KEY);
  const ids = plan.absencePlan.deactivations.map((d) => d.jobSourceId);
  const rows = await db.jobSource.findMany({ where: { id: { in: ids } }, select: { externalId: true, jobId: true, lastSeenAt: true,
    job: { select: { title: true, city: true, isActive: true } } }, orderBy: { externalId: 'asc' } });
  const closing = new Set(plan.wouldClose);
  // La garde du RUN, sur son périmètre : toutes les sources ACTIVE (swatch-group l'est après la réouverture).
  const active = (await db.source.findMany({ where: { status: 'ACTIVE' }, select: { key: true } })).map((s) => s.key);
  const runLive = await db.job.count({ where: { isActive: true, mergedIntoId: null, sources: { some: { sourceKey: { in: active } } } } });
  const n = plan.wouldClose.length;
  const runRefused = n >= REFRESH_LIMITS.minCloseForGuard && runLive > 0 && n / runLive > REFRESH_LIMITS.maxCloseRatio;
  const expected = readFileSync(new URL('../fermetures-a-blanc.csv', import.meta.url), 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')[0]);
  const listed = rows.map((r) => r.externalId);
  console.log(JSON.stringify({
    at: plan.asOf, cutoff: plan.cutoff, swatchGroupActive: active.includes(KEY), eligibility,
    deactivations: rows.length, jobsCandidateForClosure: n,
    runGuard: { perimeterLiveJobs: runLive, closuresFromSwatch: n, ratioPct: runLive ? 100 * n / runLive : 0, limits: REFRESH_LIMITS, refused: runRefused },
    vsDryRun02Oct: { stillAbsent: listed.filter((id) => expected.includes(id)).length,
      newlyAbsent: listed.filter((id) => !expected.includes(id)), backOnSite: expected.filter((id) => !listed.includes(id)) },
    list: rows.map((r) => ({ externalId: r.externalId, title: r.job?.title, city: r.job?.city, lastSeenAt: r.lastSeenAt,
      consequence: r.jobId && closing.has(r.jobId) ? 'JOB_CANDIDATE_FOR_CLOSURE' : 'JOB_KEPT_BY_ANOTHER_SOURCE' })),
  }, null, 1));
} finally {
  await db.$disconnect();
}
