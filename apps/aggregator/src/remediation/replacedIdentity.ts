import type { PrismaClient } from '@prisma/client';
import { json, type Operation, type RepairPlan } from './plan.js';

/**
 * RETIRER LES REPRÉSENTATIONS D'UNE SOURCE LUES SOUS UNE IDENTITÉ QUE SON NOUVEAU LECTEUR A REMPLACÉE (D-522 §6, Kastner &
 * Öhler, 03/10/2026).
 *
 * Kastner & Öhler passe de la lecture de page de départ (identité : empreinte de l'adresse de la page, `genericJsonLd.ts`)
 * au lecteur `wordpress-post-type` (identité : `id` natif du billet). Les mêmes offres reviennent sous une nouvelle identité,
 * et l'ancienne lecture ne prouvait aucune liste : ses représentations ne fermeront jamais d'elles-mêmes. Rendre probante
 * la nouvelle terminaison les FERMERAIT au premier refresh, comme des fins d'offre au nom de l'employeur, alors que ce sont
 * les mêmes offres sous une autre identité (et 12 fermetures sur 12 déclencheraient la garde de masse) : cette voie n'est
 * pas prise. Ce plan relu les RETIRE (`PUBLICATION_UNVERIFIED`, jamais une fermeture), APRÈS la première collecte sous la
 * nouvelle configuration :
 *   · la révision remplacée n'est plus la configuration courante, et la révision courante a déjà des représentations
 *     actives (sinon le plan refuse : appliqué trop tôt, il dépublierait des offres que rien ne remplace encore) ;
 *   · chaque ancienne représentation est soit REMPLACÉE (une représentation active de la révision courante porte la même
 *     page, fragment retiré), soit NON LISTÉE (aucune ne la porte : l'éditeur ne la publie plus dans la liste prouvée) ;
 *   · les deux comptes sont exactement ceux qui ont été relus ;
 *   · l'offre d'une ancienne représentation n'a aucune autre représentation active.
 * Rien n'est supprimé ; chaque ligne garde son image avant dans `DataCorrection` (`applyRepairPlan`, tout ou rien).
 */
export type ReplacedIdentitySpec = { batchId: string; sourceKey: string; replacedRevisionId: string;
  expectedReplaced: number; expectedUnlisted: number; statement: string };
type Entry = { id: string; url: string; raw?: unknown; revisionId: string | null };

const pageOf = (entry: Entry) => {
  const page = (entry.raw as { catwalksPageUrl?: unknown } | null)?.catwalksPageUrl;
  const url = new URL(typeof page === 'string' ? page : entry.url); url.hash = '';
  return url.href;
};

/** La partition relue, sans base : anciennes représentations remplacées et non listées, ou un refus nommé. */
export function partitionReplacedIdentity<E extends Entry>(entries: readonly E[], spec: ReplacedIdentitySpec, currentRevisionId: string | null):
  { replaced: Array<{ old: E; by: E }>; unlisted: E[] } {
  if (!spec?.batchId || !spec.sourceKey || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(spec.replacedRevisionId ?? '') ||
    ![spec.expectedReplaced, spec.expectedUnlisted].every(n => Number.isSafeInteger(n) && n >= 0) || spec.expectedReplaced + spec.expectedUnlisted < 1 ||
    (spec.statement ?? '').trim().length < 30) throw new Error('Reviewed replaced identity specification required');
  if (!currentRevisionId || currentRevisionId === spec.replacedRevisionId) throw new Error('The replaced revision is still the current configuration: correct the source first');
  const current = entries.filter(entry => entry.revisionId === currentRevisionId);
  if (!current.length) throw new Error('No active representation from the current revision yet: apply after its first collection');
  const byPage = new Map(current.map(entry => [pageOf(entry), entry]));
  const replaced: Array<{ old: E; by: E }> = [], unlisted: E[] = [];
  for (const old of entries.filter(entry => entry.revisionId === spec.replacedRevisionId)) {
    const by = byPage.get(pageOf(old));
    if (by) replaced.push({ old, by }); else unlisted.push(old);
  }
  if (replaced.length !== spec.expectedReplaced || unlisted.length !== spec.expectedUnlisted) {
    throw new Error(`Reviewed count changed: ${replaced.length} replaced and ${unlisted.length} unlisted, ${spec.expectedReplaced} and ${spec.expectedUnlisted} reviewed`);
  }
  return { replaced, unlisted };
}

export async function planReplacedIdentity(prisma: PrismaClient, spec: ReplacedIdentitySpec): Promise<RepairPlan> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const source = await tx.source.findUniqueOrThrow({ where: { key: spec?.sourceKey ?? '' } });
    if (source.status === 'RETIRED') throw new Error('A retired source is withdrawn with its source, not by this plan');
    const revision = await tx.sourceRevision.findUniqueOrThrow({ where: { id: spec.replacedRevisionId } });
    if (revision.sourceKey !== spec.sourceKey) throw new Error('Replaced revision belongs to another source');
    const rows = await tx.jobSource.findMany({ where: { sourceKey: spec.sourceKey, isActive: true },
      include: { job: { include: { sources: true }, omit: { searchText: true } } }, orderBy: { id: 'asc' } });
    const batches = new Map((await tx.captureBatch.findMany({ where: { id: { in: rows.flatMap(r => r.captureBatchId ? [r.captureBatchId] : []) } },
      select: { id: true, sourceRevisionId: true } })).map(b => [b.id, b.sourceRevisionId]));
    const entries = rows.map(row => ({ ...row, revisionId: row.captureBatchId ? batches.get(row.captureBatchId) ?? null : null }));
    const { replaced, unlisted } = partitionReplacedIdentity(entries, spec, source.currentRevisionId);
    const at = new Date().toISOString();
    const operations: Operation[] = [];
    const companyIds = new Set<string>();
    const withdraw = (entry: (typeof entries)[number], why: string) => {
      const { job, revisionId: _revisionId, ...before } = entry;
      operations.push({ entity: 'JobSource', id: entry.id, before: json(before), patch: { isActive: false }, reason: why });
      if (!job || !job.isActive) return;
      if (job.sources.some(s => s.id !== entry.id && s.isActive)) throw new Error(`Other active evidence needs review: ${job.id}`);
      const { sources: _sources, ...jobBefore } = job;
      companyIds.add(job.companyId);
      operations.push({ entity: 'Job', id: job.id, before: json(jobBefore),
        patch: { isActive: false, closedAt: null, withdrawnAt: at, withdrawalReason: 'PUBLICATION_UNVERIFIED' },
        reason: `${why}; ${spec.statement}; withdrawal, not an employer closure` });
    };
    for (const { old, by } of replaced) withdraw(old, `Identity replaced by representation ${by.id} (job ${by.jobId}) of revision ${source.currentRevisionId}`);
    for (const old of unlisted) withdraw(old, `Not in the list of revision ${source.currentRevisionId}; read only by replaced revision ${revision.id}`);
    return { version: 1, batchId: spec.batchId, finding: 'REPLACED_IDENTITY_REPRESENTATIONS', createdAt: at,
      sourceKeys: [spec.sourceKey], companyIds: [...companyIds].sort(), operations,
      evidence: { replacedRevisionId: revision.id, currentRevisionId: source.currentRevisionId,
        replaced: replaced.map(({ old, by }) => ({ old: old.id, by: by.id })), unlisted: unlisted.map(entry => entry.id),
        statement: spec.statement, preserve: 'No deletion: source, company and current representations untouched; before images and WITHDRAWN/CORRECTED events' },
      invariants: ['lifecycle'] };
  });
}
