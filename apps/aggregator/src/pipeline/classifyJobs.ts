import type { PrismaClient } from '@prisma/client';
import { classifyJob, TAXONOMY_VERSION } from '../normalize/taxonomy.js';

/**
 * `classify-jobs` — rejoue la taxonomie Intelligence (D38) sur toute la base,
 * actives ET fermées : l'historique se lit par métier et par séniorité, donc
 * une offre fermée avant l'existence des règles doit être classée aussi.
 *
 * Idempotente et reprenable : ne touche que les lignes dont
 * `taxonomyVersion < TAXONOMY_VERSION` (ou toutes avec `--all`), par lots,
 * en lisant titre / département / description / contrat — jamais le réseau.
 */
export type ClassifyJobsOptions = {
  batchSize?: number;
  /** Re-classe aussi les lignes déjà à jour (après un changement de règles sans bump). */
  all?: boolean;
  /** Au plus N lignes (0 = toutes). */
  limit?: number;
  dryRun?: boolean;
};

export type ClassifyJobsStats = {
  scanned: number;
  written: number;
  byFunction: Record<string, number>;
  bySeniority: Record<string, number>;
  unclassified: number;
  aiRelated: number;
};

const DEFAULT_BATCH = 500;

export async function classifyJobs(prisma: PrismaClient, options: ClassifyJobsOptions = {}): Promise<ClassifyJobsStats> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const stats: ClassifyJobsStats = { scanned: 0, written: 0, byFunction: {}, bySeniority: {}, unclassified: 0, aiRelated: 0 };
  const where = options.all ? {} : { taxonomyVersion: { lt: TAXONOMY_VERSION } };
  let cursor: string | undefined;

  for (;;) {
    const rows = await prisma.job.findMany({
      where,
      select: { id: true, title: true, department: true, description: true, contract: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      const c = classifyJob(row);
      stats.scanned++;
      const fn = c.jobFunction ?? '(non classé)';
      stats.byFunction[fn] = (stats.byFunction[fn] ?? 0) + 1;
      stats.bySeniority[c.seniority] = (stats.bySeniority[c.seniority] ?? 0) + 1;
      if (!c.jobFunction) stats.unclassified++;
      if (c.isAiRelated) stats.aiRelated++;
      if (options.dryRun) continue;
      await prisma.job.update({ where: { id: row.id }, data: c });
      stats.written++;
    }

    cursor = rows[rows.length - 1].id;
    if (options.limit && stats.scanned >= options.limit) break;
    if (rows.length < batchSize) break;
  }
  return stats;
}
