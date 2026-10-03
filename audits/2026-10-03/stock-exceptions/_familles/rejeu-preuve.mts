/**
 * D-522 §6, groupe « familles » : rejoue HORS RÉSEAU la capture d'une source au RUN 9022fc4b (02/10/2026, release r5)
 * avec le lecteur de CE worktree, et dit ce que le normaliseur en conclut (preuve de parcours, contrat canonique).
 * Lecture seule : aucune écriture, aucune requête réseau (rejeu des réponses archivées de la capture).
 *
 *   CATWALKS_DB_ACCESS=<accès> python3 apps/aggregator/scripts/ops/db.py readonly \
 *     npx tsx audits/2026-10-03/stock-exceptions/_familles/rejeu-preuve.mts <clé>=<captureBatchId> ...
 *
 * Les captureBatchId sont ceux des événements `source.issue_classified` du RUN 9022fc4b-1b96-431d-bee9-86ed244ef4f1.
 */
import { PrismaClient } from '@prisma/client';
import { replayExtraction } from '../../../../apps/aggregator/src/capture/batch.js';
import { fetchAtsJobs } from '../../../../apps/aggregator/src/ats/index.js';
import { KIND_TO_ATS } from '../../../../apps/aggregator/src/ats/catalogKinds.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DB_URL ?? process.env.DATABASE_URL } } });
for (const arg of process.argv.slice(2)) {
  const [key, batchId] = arg.split('=');
  const [src] = await prisma.$queryRawUnsafe<Array<{ kind: string; config: Record<string, unknown> }>>(`SELECT kind, config FROM "Source" WHERE key = $1`, key);
  try {
    const r = await replayExtraction(prisma as never, batchId!, () => fetchAtsJobs(KIND_TO_ATS[src!.kind]!, src!.config));
    const e = r.enumeration;
    const pages = e?.pageEvidence ?? [];
    console.log(JSON.stringify({ key, batchId, kind: src!.kind, jobs: r.jobs.length, declaredTotal: r.declaredTotal, truncated: r.truncated ?? false,
      complete: r.complete ?? null, verdict: r.enumerationVerdict, termination: e?.termination, issues: e?.issues,
      canonicalAbsenceProofUsable: e?.canonicalAbsenceProofUsable, evidencePages: pages.length,
      pagesDeclaringCanonical: pages.filter((p) => Object.hasOwn(p, 'canonicalIds')).length,
      canonicalIdViolations: e?.canonicalIdViolations?.slice(0, 3) }));
  } catch (error) {
    console.log(JSON.stringify({ key, batchId, error: String(error instanceof Error ? error.message : error).slice(0, 300) }));
  }
}
await prisma.$disconnect();
