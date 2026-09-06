import type { PrismaClient } from '@prisma/client';
import { AI_TITLE_RE, classifyJob, comparableTitle, TAXONOMY_VERSION } from '../normalize/taxonomy.js';

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

export async function aiCompanyGuard(prisma: PrismaClient): Promise<AiGuardStats> {
  const suspects = await prisma.$queryRaw<{ companyId: string; total: bigint; ai: bigint }[]>`
    SELECT "companyId", count(*)::bigint AS total, count(*) FILTER (WHERE "isAiRelated")::bigint AS ai
    FROM "Job" WHERE "isActive"
    GROUP BY "companyId"
    HAVING count(*) >= ${AI_COMPANY_MIN_JOBS} AND count(*) FILTER (WHERE "isAiRelated")::float / count(*) > ${AI_COMPANY_SHARE}
  `;
  let cleared = 0;
  for (const s of suspects) {
    const rows = await prisma.job.findMany({ where: { companyId: s.companyId, isAiRelated: true }, select: { id: true, title: true } });
    const toClear = rows.filter((r) => !AI_TITLE_RE.test(comparableTitle(r.title))).map((r) => r.id);
    if (toClear.length) {
      const r = await prisma.job.updateMany({ where: { id: { in: toClear } }, data: { isAiRelated: false } });
      cleared += r.count;
    }
  }
  return { companies: suspects.length, cleared };
}

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
  aiGuard?: AiGuardStats;
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
  if (!options.dryRun) {
    const guard = await aiCompanyGuard(prisma);
    stats.aiRelated -= guard.cleared;
    stats.aiGuard = guard;
  }
  return stats;
}
