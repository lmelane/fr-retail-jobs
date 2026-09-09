import { Prisma } from "@prisma/client";
import {
  loadOccupationTaxonomy,
  lockOccupationTaxonomy,
  occupationManifestHash,
} from "@catwalks/db/occupations";
import {
  classifyOccupationContent,
  occupationState,
} from "../occupation/persist.js";
import {
  writeOccupationBatch,
  type OccupationChange,
} from "../occupation/batch.js";
import { log } from "../observability/logger.js";
import type { PrismaClient } from "@prisma/client";
import {
  AI_TITLE_RE,
  comparableTitle,
  TAXONOMY_VERSION,
} from "../normalize/taxonomy.js";

/**
 * Garde par société (audit I-3, principe mesuré) : un drapeau IA porté par
 * plus de 80 % des offres d'une société de ≥ 20 offres est un TEXTE
 * D'ENTREPRISE recopié dans chaque annonce (Infuse 410/410, The RealReal
 * 136/136, Quince 133/133, Peloton 49/49), pas un métier. Pour ces sociétés,
 * seules les offres dont le TITRE parle d'IA gardent le drapeau.
 */
export const AI_COMPANY_SHARE = 0.8;
export const AI_COMPANY_MIN_JOBS = 20;

export type AiGuardStats = { companies: number; cleared: number };

export async function aiCompanyGuard(
  prisma: PrismaClient,
): Promise<AiGuardStats> {
  const suspects = await prisma.$queryRaw<
    { companyId: string; total: bigint; ai: bigint }[]
  >`
    SELECT "companyId", count(*)::bigint AS total, count(*) FILTER (WHERE "isAiRelated")::bigint AS ai
    FROM "Job" WHERE "isActive"
    GROUP BY "companyId"
    HAVING count(*) >= ${AI_COMPANY_MIN_JOBS} AND count(*) FILTER (WHERE "isAiRelated")::float / count(*) > ${AI_COMPANY_SHARE}
  `;
  let cleared = 0;
  for (const s of suspects) {
    const rows = await prisma.job.findMany({
      where: { companyId: s.companyId, isAiRelated: true },
      select: { id: true, title: true },
    });
    const toClear = rows
      .filter((r) => !AI_TITLE_RE.test(comparableTitle(r.title)))
      .map((r) => r.id);
    if (toClear.length) {
      const r = await prisma.job.updateMany({
        where: { id: { in: toClear } },
        data: { isAiRelated: false },
      });
      cleared += r.count;
    }
  }
  return { companies: suspects.length, cleared };
}

/**
 * Replay the active immutable occupation release on canonical postings.
 * Only occupation fields are written. Lifecycle, contracts and source evidence
 * remain intact; the append-only decision ledger stores every changed state.
 */
export type ClassifyJobsOptions = {
  batchSize?: number;
  /** Vérifie aussi les lignes déjà à la version active, notamment pour prouver l’idempotence. */
  all?: boolean;
  /** Au plus N lignes (0 = toutes). */
  limit?: number;
  dryRun?: boolean;
  expectedRelease?: string;
};

export type ClassifyJobsStats = {
  scanned: number;
  written: number;
  byFunction: Record<string, number>;
  bySeniority: Record<string, number>;
  unclassified: number;
  aiRelated: number;
  aiGuard?: AiGuardStats;
  releaseId?: string;
  statuses?: Record<string, number>;
  changedDuringRun?: number;
  unchanged?: number;
  remaining?: number;
};

const DEFAULT_BATCH = 500;

export async function classifyJobs(
  prisma: PrismaClient,
  options: ClassifyJobsOptions = {},
): Promise<ClassifyJobsStats> {
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit < 0)
  )
    throw new Error("Occupation replay limit must be a nonnegative integer");
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new Error("Occupation batch size must be between 1 and 1000");
  const catalogue = await loadOccupationTaxonomy(prisma);
  if (
    options.expectedRelease &&
    options.expectedRelease !== catalogue.manifest.id
  )
    throw new Error(
      "Active occupation release differs from the reviewed replay",
    );
  const stats: ClassifyJobsStats = {
    scanned: 0,
    written: 0,
    byFunction: {},
    bySeniority: {},
    unclassified: 0,
    aiRelated: 0,
    releaseId: catalogue.manifest.id,
    statuses: {},
    changedDuringRun: 0,
    unchanged: 0,
  };
  const where: Prisma.JobWhereInput = {
    mergedIntoId: null,
    ...(options.all
      ? {}
      : {
          OR: [
            { occupationReleaseId: null },
            { occupationReleaseId: { not: catalogue.manifest.id } },
          ],
        }),
  };
  let cursor: string | undefined;
  for (;;) {
    const remaining = options.limit ? options.limit - stats.scanned : batchSize;
    if (remaining <= 0) break;
    const rows = await prisma.job.findMany({
      where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: {
        id: true,
        title: true,
        department: true,
        rawTitle: true,
        updatedAt: true,
        jobFunction: true,
        occupationCode: true,
        occupationGroup: true,
        normalizedTitle: true,
        occupationStatus: true,
        occupationEvidence: true,
        occupationReleaseId: true,
        occupationSpecializations: true,
        seniority: true,
        isRetail: true,
        isAiRelated: true,
        canonicalSourceKey: true,
        canonicalExternalId: true,
      },
      orderBy: { id: "asc" },
      take: Math.min(batchSize, remaining),
    });
    if (!rows.length) break;
    const changes: OccupationChange[] = [];
    for (const row of rows) {
      const c = classifyOccupationContent(
        {
          title: row.title,
          department: row.department,
          rawTitle: row.rawTitle,
          sourceKey: row.canonicalSourceKey ?? undefined,
          externalId: row.canonicalExternalId ?? undefined,
        },
        catalogue,
      );
      stats.scanned++;
      const fn = c.jobFunction ?? "(non classé)",
        rank = c.seniority ?? "(non renseigné)";
      stats.byFunction[fn] = (stats.byFunction[fn] ?? 0) + 1;
      stats.bySeniority[rank] = (stats.bySeniority[rank] ?? 0) + 1;
      stats.statuses![c.occupationStatus] =
        (stats.statuses![c.occupationStatus] ?? 0) + 1;
      if (!c.jobFunction) stats.unclassified++;
      if (row.isAiRelated) stats.aiRelated++;
      if (
        occupationManifestHash(occupationState(row)) ===
        occupationManifestHash(occupationState(c))
      ) {
        stats.unchanged!++;
        continue;
      }
      if (options.dryRun) continue;
      changes.push({ before: row, after: c });
    }
    let batchWritten = 0;
    if (changes.length) {
      const written = await prisma.$transaction(
        async (tx) => {
          const current = await lockOccupationTaxonomy(tx, catalogue);
          if (current.manifest.id !== catalogue.manifest.id)
            throw new Error("OCCUPATION_RELEASE_CHANGED_DURING_REPLAY");
          return writeOccupationBatch(tx, changes);
        },
        { timeout: 30_000 },
      );
      batchWritten = written;
      stats.written += written;
      stats.changedDuringRun! += changes.length - written;
    }
    cursor = rows.at(-1)!.id;
    if (batchWritten > 0)
      await prisma.occupationState.updateMany({
        where: { id: "active", releaseId: catalogue.manifest.id },
        data: { updatedAt: new Date() },
      });
    await log.info("occupation.batch_completed", {
      releaseId: catalogue.manifest.id,
      scanned: stats.scanned,
      written: stats.written,
      dryRun: !!options.dryRun,
    });
    if (rows.length < Math.min(batchSize, remaining)) break;
  }
  // Contracts, source timestamps, lifecycle, AI and skills are separate lots.
  if (!options.dryRun)
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "OccupationState" WHERE id='active' FOR UPDATE`;
      const state = await tx.occupationState.findUniqueOrThrow({
        where: { id: "active" },
      });
      if (state.releaseId !== catalogue.manifest.id)
        throw new Error("OCCUPATION_RELEASE_CHANGED_DURING_REPLAY");
      stats.remaining = await tx.job.count({
        where: {
          mergedIntoId: null,
          OR: [
            { occupationReleaseId: null },
            { occupationReleaseId: { not: catalogue.manifest.id } },
          ],
        },
      });
      if (stats.remaining === 0 && !state.backfilledAt)
        await tx.occupationState.update({
          where: { id: "active" },
          data: { backfilledAt: new Date() },
        });
    });
  if (stats.written > 0 && stats.remaining === 0)
    await prisma.$executeRaw`ANALYZE "Job" ("occupationCode","occupationStatus","occupationGroup","occupationReleaseId","jobFunction",seniority,"isRetail")`;
  return stats;
}
