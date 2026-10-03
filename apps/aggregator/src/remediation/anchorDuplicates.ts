import type { PrismaClient } from '@prisma/client';
import { json, type Operation, type RepairPlan } from './plan.js';

/**
 * RETIRER LES COPIES D'UNE OFFRE PUBLIÉES UNE FOIS PAR ANCRE DE SA PAGE (D-522 §6, Lumentee, 03/10/2026).
 *
 * La lecture d'une page de départ relisait la page par chacune de ses ancres (`#roles`, `#main`, `#culture`, `#`), et
 * l'identité générique est l'empreinte de l'adresse : une même offre, « D2C Growth Marketer », est publiée cinq fois. Le
 * lecteur est corrigé (`genericJsonLd.ts`) ; les quatre copies ne peuvent pas être fermées par la collecte, dont la liste
 * ne prouve aucune absence. Ni `plan-homonym-representations` (les copies viennent de la révision COURANTE, et ce n'est
 * pas un employeur contredit), ni `publication-groups` (aucune preuve d'identité native entre les copies, et une copie
 * se reconstruit de son RAW) ne s'y prêtent.
 *
 * Le plan relu garde la représentation à la vraie adresse et ne retire que les adresses NOMMÉES par le relecteur, sous
 * quatre conditions vérifiées, sans quoi il refuse :
 *   · chaque copie est la même page que la représentation gardée, à l'ancre près (adresse sans fragment identique) ;
 *   · elle porte le même intitulé ;
 *   · l'offre de chaque copie n'a aucune autre représentation active, et la représentation gardée reste active ;
 *   · le nombre de copies actives est exactement celui qui a été relu.
 * Effets : JobSource isActive=false ; Job retrait `PUBLICATION_UNVERIFIED` (le motif des identités historiques retirées
 * par une réparation de dédoublonnage), jamais une fermeture au nom de l'employeur. Rien n'est supprimé ; chaque ligne
 * garde son image avant dans `DataCorrection` (`applyRepairPlan`, tout ou rien).
 */
export type AnchorDuplicatesSpec = { batchId: string; sourceKey: string; keepUrl: string; duplicateUrls: string[]; statement: string };
type Entry = { id: string; url: string; title: string | null; isActive: boolean; jobId: string | null };

const page = (value: string) => { const url = new URL(value); url.hash = ''; return url.href; };

/** La sélection relue, sans base : la représentation gardée et les copies nommées, ou un refus nommé. */
export function selectAnchorDuplicates<E extends Entry>(entries: readonly E[], spec: AnchorDuplicatesSpec): { keep: E; duplicates: E[] } {
  if (!spec?.batchId || !spec.sourceKey || !/^https:\/\//.test(spec.keepUrl ?? '') || !Array.isArray(spec.duplicateUrls) || !spec.duplicateUrls.length ||
    new Set(spec.duplicateUrls).size !== spec.duplicateUrls.length || spec.duplicateUrls.includes(spec.keepUrl) || (spec.statement ?? '').trim().length < 30) {
    throw new Error('Reviewed anchor duplicates specification required');
  }
  const active = entries.filter(entry => entry.isActive);
  const kept = active.filter(entry => entry.url === spec.keepUrl);
  if (kept.length !== 1) throw new Error(`The kept representation must be exactly one active row: ${kept.length}`);
  const keep = kept[0]!;
  const duplicates = active.filter(entry => spec.duplicateUrls.includes(entry.url));
  if (duplicates.length !== spec.duplicateUrls.length) {
    throw new Error(`Reviewed count changed: ${duplicates.length} active duplicates, ${spec.duplicateUrls.length} reviewed`);
  }
  for (const duplicate of duplicates) {
    if (page(duplicate.url) !== page(keep.url)) throw new Error(`Not an anchor of the kept page: ${duplicate.url}`);
    if ((duplicate.title ?? '').trim() !== (keep.title ?? '').trim()) throw new Error(`Different title needs review: ${duplicate.url}`);
    if (!duplicate.jobId || duplicate.jobId === keep.jobId) throw new Error(`Duplicate shares the kept offer or has none: ${duplicate.url}`);
  }
  return { keep, duplicates };
}

export async function planAnchorDuplicates(prisma: PrismaClient, spec: AnchorDuplicatesSpec): Promise<RepairPlan> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const source = await tx.source.findUniqueOrThrow({ where: { key: spec?.sourceKey ?? '' } });
    if (source.status === 'RETIRED') throw new Error('A retired source is withdrawn with its source, not by this plan');
    const entries = await tx.jobSource.findMany({ where: { sourceKey: spec.sourceKey, isActive: true },
      include: { job: { include: { sources: true }, omit: { searchText: true } } }, orderBy: { id: 'asc' } });
    const { keep, duplicates } = selectAnchorDuplicates(entries, spec);
    if (!keep.job?.isActive) throw new Error('The kept representation must stay published');
    const at = new Date().toISOString();
    const operations: Operation[] = [];
    const companyIds = new Set<string>();
    for (const entry of duplicates) {
      const { job, ...before } = entry;
      operations.push({ entity: 'JobSource', id: entry.id, before: json(before), patch: { isActive: false },
        reason: `Anchor copy of ${spec.keepUrl} (${entry.url}); the representation at the page address is kept` });
      if (!job || !job.isActive) continue;
      if (job.sources.some(s => s.id !== entry.id && s.isActive)) throw new Error(`Other active evidence needs review: ${job.id}`);
      const { sources: _sources, ...jobBefore } = job;
      companyIds.add(job.companyId);
      operations.push({ entity: 'Job', id: job.id, before: json(jobBefore),
        patch: { isActive: false, closedAt: null, withdrawnAt: at, withdrawalReason: 'PUBLICATION_UNVERIFIED' },
        reason: `Duplicate publication of job ${keep.jobId}: ${spec.statement}; withdrawal, not an employer closure` });
    }
    return { version: 1, batchId: spec.batchId, finding: 'ANCHOR_DUPLICATE_REPRESENTATIONS', createdAt: at,
      sourceKeys: [spec.sourceKey], companyIds: [...companyIds].sort(), operations,
      evidence: { keptRepresentationId: keep.id, keptJobId: keep.jobId, keepUrl: spec.keepUrl, duplicateUrls: [...spec.duplicateUrls].sort(),
        statement: spec.statement, preserve: 'No deletion: source, company and kept offer untouched; before images and WITHDRAWN/CORRECTED events' },
      invariants: ['lifecycle'] };
  });
}
