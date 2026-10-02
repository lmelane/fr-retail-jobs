import { Prisma, type PrismaClient } from '@prisma/client';
import { selectApplySource } from '@catwalks/db/publications';
import type { ObjectStore } from '../retention/objectStore.js';
import { applyPublicationGroups, planPublicationGroups, type GroupRepairPlan } from './repair.js';

/**
 * R-143 §4 (D-513) : le rattrapage du stock. L'ingestion rapproche une publication NOUVELLE de l'offre qui porte déjà
 * sa clé d'identité (`upsert.ts`, `clusterJobs`) ; une publication déjà rattachée à sa propre offre y reste, même quand une
 * preuve native apparaît plus tard (nouvelle preuve du code, texte qui gagne son « Job ID »). Ces offres scindées portent
 * la même clé native : on les retrouve par cette clé, puis la réparation existante (`repair.ts`) recontrôle TOUTE la
 * preuve deux à deux sur le RAW avant d'écrire, et garde l'ancien identifiant public en redirection.
 *
 * Deux temps, comme toute réparation relue : l'aperçu écrit un fichier (groupes, offre conservée, empreinte de chaque
 * plan) ; l'application n'applique QUE ce fichier, et refuse sans rien écrire si l'aperçu recalculé en diffère.
 */
const NATIVE_KEY = /^\["(?:requisition|feed-publication|application)",/;
const MAX_JOBS_PER_GROUP = 25;
export const DEFAULT_CONSOLIDATION_LIMIT = 500;
export const CONSOLIDATION_FILE_KIND = 'r143-consolidation/1';

export type SplitGroup = { companyId: string; clusterKey: string; jobIds: string[] };
export type ReviewedGroup = SplitGroup & { survivor: string; sourceIds: string[]; planHash: string };
export type ConsolidationFile = { kind: typeof CONSOLIDATION_FILE_KIND; limit: number; groups: ReviewedGroup[];
  refused: Array<{ clusterKey: string; jobIds: string[]; reason: string }> };
export type ConsolidationReport = { groups: number; planned: number; applied: number; alreadyApplied: number;
  refused: Array<{ clusterKey: string; jobIds: string[]; reason: string }> };

/** Offres actives d'un même employeur qui portent la même clé d'identité native (au plus `limit` groupes, ordre stable). */
export async function splitIdentityGroups(db: PrismaClient, limit = DEFAULT_CONSOLIDATION_LIMIT): Promise<SplitGroup[]> {
  const rows = await db.$queryRaw<Array<{ companyId: string; clusterKey: string; jobIds: string[] }>>(Prisma.sql`
    SELECT "companyId", "clusterKey", array_agg(id ORDER BY "firstSeenAt", id) AS "jobIds"
    FROM "Job" WHERE "isActive" AND "mergedIntoId" IS NULL AND "clusterKey" IS NOT NULL
      AND ("clusterKey" LIKE '["requisition",%' OR "clusterKey" LIKE '["feed-publication",%' OR "clusterKey" LIKE '["application",%')
    GROUP BY 1, 2 HAVING count(*) BETWEEN 2 AND ${MAX_JOBS_PER_GROUP}
    ORDER BY 1, 2 LIMIT ${limit}`);
  return rows.filter(row => NATIVE_KEY.test(row.clusterKey));
}

const REASON = 'R-143 §4 (D-513) : une même publication native, prouvée deux à deux sur le RAW, ne doit apparaître qu’une fois';

/** L'offre conservée porte la publication que choisit la règle d'autorité existante (`selectApplySource`). */
async function planGroup(db: PrismaClient, group: SplitGroup, store?: ObjectStore): Promise<{ reviewed: ReviewedGroup; plan: GroupRepairPlan }> {
  const sources = await db.jobSource.findMany({ where: { jobId: { in: group.jobIds } }, orderBy: { id: 'asc' },
    select: { id: true, jobId: true, sourceKey: true, externalId: true, sourceTier: true, isActive: true, expiresAt: true, url: true } });
  const survivor = selectApplySource(sources, {})?.jobId ?? group.jobIds[0];
  const sourceIds = sources.map(source => source.id);
  const plan = await planPublicationGroups(db, { jobIds: group.jobIds, groups: [{ jobId: survivor, sourceIds }], reason: REASON }, store);
  return { reviewed: { ...group, survivor, sourceIds, planHash: plan.planHash }, plan };
}

async function preview(db: PrismaClient, limit: number, store?: ObjectStore) {
  const planned: Array<{ reviewed: ReviewedGroup; plan: GroupRepairPlan }> = [];
  const refused: ConsolidationFile['refused'] = [];
  for (const group of await splitIdentityGroups(db, limit)) {
    try { planned.push(await planGroup(db, group, store)); }
    catch (error) { refused.push({ clusterKey: group.clusterKey, jobIds: group.jobIds, reason: error instanceof Error ? error.message.slice(0, 300) : String(error) }); }
  }
  return { planned, refused };
}

/** L'aperçu : rien n'est écrit (chaque plan est préparé en transaction READ ONLY). Le fichier rendu est celui qu'on relit. */
export async function previewConsolidation(db: PrismaClient, options: { limit?: number; store?: ObjectStore } = {}): Promise<ConsolidationFile> {
  const limit = options.limit ?? DEFAULT_CONSOLIDATION_LIMIT;
  const { planned, refused } = await preview(db, limit, options.store);
  return { kind: CONSOLIDATION_FILE_KIND, limit, groups: planned.map(item => item.reviewed), refused };
}

const fingerprint = (groups: readonly ReviewedGroup[]) => JSON.stringify(groups.map(g =>
  [g.companyId, g.clusterKey, g.jobIds, g.survivor, g.sourceIds, g.planHash]));

/** Applique le fichier relu, et lui seul : l'aperçu est recalculé, et tout écart refuse la commande avant toute écriture. */
export async function applyReviewedConsolidation(db: PrismaClient, file: ConsolidationFile, options: { store?: ObjectStore } = {}): Promise<ConsolidationReport> {
  if (file?.kind !== CONSOLIDATION_FILE_KIND || !Array.isArray(file.groups) || !Number.isSafeInteger(file.limit) || file.limit < 1) {
    throw new Error('REVIEWED_PLAN_INVALID: a consolidation preview file is required');
  }
  const { planned } = await preview(db, file.limit, options.store);
  if (fingerprint(planned.map(item => item.reviewed)) !== fingerprint(file.groups)) {
    throw new Error(`REVIEWED_PLAN_MISMATCH: the recomputed preview differs from the reviewed file (${planned.length} groups now, ${file.groups.length} reviewed); preview again`);
  }
  const report: ConsolidationReport = { groups: planned.length, planned: planned.length, applied: 0, alreadyApplied: 0, refused: [] };
  for (const { reviewed, plan } of planned) {
    try {
      const result = await applyPublicationGroups(db, plan, reviewed.planHash, options.store);
      if (result.alreadyApplied) report.alreadyApplied++; else report.applied++;
    } catch (error) {
      report.refused.push({ clusterKey: reviewed.clusterKey, jobIds: reviewed.jobIds, reason: error instanceof Error ? error.message.slice(0, 300) : String(error) });
    }
  }
  return report;
}
