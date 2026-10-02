import { Prisma, type PrismaClient } from '@prisma/client';
import { selectApplySource } from '@catwalks/db/publications';
import type { ObjectStore } from '../retention/objectStore.js';
import { applyPublicationGroups, planPublicationGroups } from './repair.js';

/**
 * R-143 §4 (D-513) : le rattrapage du stock. L'ingestion ne rapproche qu'une publication NOUVELLE de l'offre qui porte déjà
 * sa clé d'identité (`upsert.ts`, `clusterJobs`) ; une publication déjà rattachée à sa propre offre y reste, même quand une
 * preuve native apparaît plus tard (nouvelle preuve du code, texte qui gagne son « Job ID »). Ces offres scindées portent
 * la même clé native : on les retrouve par cette clé, puis la réparation existante (`repair.ts`) recontrôle TOUTE la
 * preuve deux à deux sur le RAW avant d'écrire, et garde l'ancien identifiant public en redirection.
 *
 * La clé n'est qu'un index : un groupe sans preuve complète est refusé par la réparation et compté, jamais forcé.
 */
const NATIVE_KEY = /^\["(?:requisition|feed-publication|application)",/;
const MAX_JOBS_PER_GROUP = 25;

export type SplitGroup = { companyId: string; clusterKey: string; jobIds: string[] };
export type ConsolidationReport = { groups: number; planned: number; applied: number; alreadyApplied: number;
  refused: Array<{ clusterKey: string; jobIds: string[]; reason: string }> };

/** Offres actives d'un même employeur qui portent la même clé d'identité native. */
export async function splitIdentityGroups(db: PrismaClient, limit = 500): Promise<SplitGroup[]> {
  const rows = await db.$queryRaw<Array<{ companyId: string; clusterKey: string; jobIds: string[] }>>(Prisma.sql`
    SELECT "companyId", "clusterKey", array_agg(id ORDER BY "firstSeenAt", id) AS "jobIds"
    FROM "Job" WHERE "isActive" AND "mergedIntoId" IS NULL AND "clusterKey" IS NOT NULL
      AND ("clusterKey" LIKE '["requisition",%' OR "clusterKey" LIKE '["feed-publication",%' OR "clusterKey" LIKE '["application",%')
    GROUP BY 1, 2 HAVING count(*) BETWEEN 2 AND ${MAX_JOBS_PER_GROUP}
    ORDER BY 1, 2 LIMIT ${limit}`);
  return rows.filter(row => NATIVE_KEY.test(row.clusterKey));
}

/**
 * Prévisualise (par défaut) ou applique la réunion de chaque groupe. L'offre conservée est celle qui porte la publication
 * que la règle d'autorité existante choisit (`selectApplySource`) ; les autres identifiants publics redirigent vers elle.
 */
export async function consolidateIdentityGroups(db: PrismaClient, options: { apply?: boolean; limit?: number; store?: ObjectStore } = {}): Promise<ConsolidationReport> {
  const groups = await splitIdentityGroups(db, options.limit);
  const report: ConsolidationReport = { groups: groups.length, planned: 0, applied: 0, alreadyApplied: 0, refused: [] };
  for (const group of groups) {
    try {
      const sources = await db.jobSource.findMany({ where: { jobId: { in: group.jobIds } }, orderBy: { id: 'asc' },
        select: { id: true, jobId: true, sourceKey: true, externalId: true, sourceTier: true, isActive: true, expiresAt: true, url: true } });
      const owner = selectApplySource(sources, {});
      const survivor = owner?.jobId ?? group.jobIds[0];
      const plan = await planPublicationGroups(db, { jobIds: group.jobIds, groups: [{ jobId: survivor, sourceIds: sources.map(source => source.id) }],
        reason: 'R-143 §4 (D-513) : une même publication native, prouvée deux à deux sur le RAW, ne doit apparaître qu’une fois' }, options.store);
      report.planned++;
      if (!options.apply) continue;
      const result = await applyPublicationGroups(db, plan, plan.planHash, options.store);
      if (result.alreadyApplied) report.alreadyApplied++; else report.applied++;
    } catch (error) {
      report.refused.push({ clusterKey: group.clusterKey, jobIds: group.jobIds, reason: error instanceof Error ? error.message.slice(0, 300) : String(error) });
    }
  }
  return report;
}
