/** Les faits d'une ingestion P9, par source : servis, uniques, écrits, publiés. Lecture seule. */
import { PrismaClient } from '@prisma/client';
const runId = process.argv.find((a) => a.startsWith('--run-id='))?.slice(9);
const p = new PrismaClient();
const runs = await p.sourceRun.findMany({ where: runId ? { runId } : { sourceKey: { in: ['hugo-boss-phenom','skechers-phenom'] } },
  select: { sourceKey: true, status: true, fetched: true, accepted: true, declaredTotal: true, errors: true, complete: true, truncated: true, canAttestAbsence: true, ranAt: true },
  orderBy: { ranAt: 'desc' }, take: 4 });
for (const r of runs) {
  const js = await p.jobSource.count({ where: { sourceKey: r.sourceKey } });
  const live = await p.jobSource.count({ where: { sourceKey: r.sourceKey, job: { isActive: true } } });
  console.log(`${r.sourceKey.padEnd(18)} ${String(r.status).padEnd(9)} servies=${r.fetched} acceptées=${r.accepted} déclaré=${r.declaredTotal} err=${r.errors} complete=${r.complete} attest=${r.canAttestAbsence} | JobSource=${js} actives=${live}`);
}
await p.$disconnect();
