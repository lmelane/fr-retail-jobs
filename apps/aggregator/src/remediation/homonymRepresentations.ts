import type { PrismaClient } from '@prisma/client';
import { json, type Operation, type RepairPlan } from './plan.js';

/**
 * RETIRER LES OFFRES D'UN HOMONYME LUES PAR UNE ANCIENNE RÉVISION D'UNE SOURCE QU'ON GARDE (D-522 §6, Sioux, 03/10/2026).
 *
 * Les chemins existants retirent une SOURCE entière (`plan-homonyms`, `retire-source`, `registry-review` : Miu Miu) : ils
 * passent la source en RETIRED, et une source retirée ne se rouvre jamais. Sioux est la bonne Maison (sioux.de) ; seule
 * sa révision v1 (Recruitee « sioux ») lisait le portail d'un homonyme, Sioux Technologies, dont 19 offres restent actives
 * sous la Maison. La source, corrigée depuis, se rouvre sur sa preuve de zéro.
 *
 * Le plan relu ne retire QUE les représentations collectées par la révision homonyme nommée (le lot de capture de chaque
 * représentation porte sa révision, jamais un motif d'adresse), et les offres qui n'ont aucune autre source active :
 *   · JobSource : isActive=false ;
 *   · Job : retrait `IDENTITY_CONTRADICTED` (événement WITHDRAWN), jamais une fermeture au nom de l'employeur ;
 *   · la Société n'est pas touchée : c'est celle de la vraie Maison.
 * Rien n'est supprimé ; chaque ligne garde son image avant dans `DataCorrection` (`applyRepairPlan`, tout ou rien).
 */
export type HomonymRepresentationsSpec = {
  batchId: string; sourceKey: string; homonymRevisionId: string; expectedRepresentations: number;
  homonym: { name: string; proofUrl: string; statement: string };
};

export async function planHomonymRepresentations(prisma: PrismaClient, spec: HomonymRepresentationsSpec): Promise<RepairPlan> {
  if (!spec?.batchId || !spec.sourceKey || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(spec.homonymRevisionId ?? '') ||
    !Number.isSafeInteger(spec.expectedRepresentations) || spec.expectedRepresentations < 1 ||
    !spec.homonym?.name || !spec.homonym.statement || !/^https:\/\//.test(spec.homonym.proofUrl ?? '')) {
    throw new Error('Reviewed homonym representations specification required');
  }
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const source = await tx.source.findUniqueOrThrow({ where: { key: spec.sourceKey } });
    if (source.status === 'RETIRED') throw new Error('A retired source is withdrawn with its source, not by this plan');
    const revision = await tx.sourceRevision.findUniqueOrThrow({ where: { id: spec.homonymRevisionId } });
    if (revision.sourceKey !== spec.sourceKey) throw new Error('Homonym revision belongs to another source');
    if (source.currentRevisionId === revision.id) throw new Error('The homonym revision is still the current configuration: correct the source first');
    const entries = await tx.jobSource.findMany({ where: { sourceKey: spec.sourceKey, isActive: true },
      include: { job: { include: { sources: true }, omit: { searchText: true } } }, orderBy: { id: 'asc' } });
    const batches = new Map((await tx.captureBatch.findMany({ where: { id: { in: entries.flatMap(e => e.captureBatchId ? [e.captureBatchId] : []) } },
      select: { id: true, sourceRevisionId: true } })).map(b => [b.id, b.sourceRevisionId]));
    const homonymEntries = entries.filter(e => e.captureBatchId && batches.get(e.captureBatchId) === revision.id);
    if (homonymEntries.length !== spec.expectedRepresentations) {
      throw new Error(`Reviewed count changed: ${homonymEntries.length} active representations from the homonym revision, ${spec.expectedRepresentations} reviewed`);
    }
    const at = new Date().toISOString();
    const operations: Operation[] = [];
    const companyIds = new Set<string>();
    for (const entry of homonymEntries) {
      const { job, ...before } = entry;
      operations.push({ entity: 'JobSource', id: entry.id, before: json(before), patch: { isActive: false },
        reason: `Representation read by homonym revision ${revision.id} (${spec.homonym.name}); source kept and corrected` });
      if (!job || !job.isActive) continue;
      if (job.sources.some(s => s.id !== entry.id && s.isActive)) throw new Error(`Other active evidence needs review: ${job.id}`);
      const { sources: _sources, ...jobBefore } = job;
      companyIds.add(job.companyId);
      operations.push({ entity: 'Job', id: job.id, before: json(jobBefore),
        patch: { isActive: false, closedAt: null, withdrawnAt: at, withdrawalReason: 'IDENTITY_CONTRADICTED' },
        reason: `Published under the wrong employer: ${spec.homonym.statement}; withdrawal, not an employer closure` });
    }
    return { version: 1, batchId: spec.batchId, finding: 'HOMONYM_REVISION_REPRESENTATIONS', createdAt: at,
      sourceKeys: [spec.sourceKey], companyIds: [...companyIds].sort(), operations,
      evidence: { homonymRevisionId: revision.id, homonymRevisionPayload: json(revision.payload), currentRevisionId: source.currentRevisionId,
        homonym: spec.homonym, preserve: 'No deletion: source kept, company untouched, before images and WITHDRAWN/CORRECTED events' },
      invariants: ['lifecycle'] };
  });
}
