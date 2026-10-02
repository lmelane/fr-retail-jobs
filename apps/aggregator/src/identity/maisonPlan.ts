import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { resolveCompany } from '../normalize/company.js';
import { digest, stable } from '../remediation/plan.js';
import { applyEmployerRepair, buildEmployerRepair, type EmployerRepairSpec } from './repair.js';
import { attachAll, nameTokens, type EmployerRow, type MaisonAttachment } from './maisonAttachment.js';

/**
 * R-143 §5 (D-513) : prévisualiser, puis appliquer, le rattachement des entités juridiques à leur Maison
 * (`maisonAttachment.ts`), une Maison par décision relue (`buildEmployerRepair` / `applyEmployerRepair`).
 * La prévisualisation n'écrit rien. L'application crée, si elle manque, la ligne Maison sous la clé du registre
 * (comme l'ingestion crée le propriétaire d'un portail), puis fusionne chaque entité dans la Maison : l'entité reste,
 * fusionnée ; ses offres passent à la Maison ; ses libellés restent observés et retrouvables.
 */
export type Snapshot = Array<EmployerRow & { servies: number; evidenceUrl: string | null }>;
export const MAISON_REVIEWER = 'R-143 §5 — rattachement prouvé (registre des sources + nom), D-513, lecture D-492';

export async function employerSnapshot(db: PrismaClient): Promise<Snapshot> {
  return db.$queryRaw<Snapshot>(Prisma.sql`
    WITH servie AS (SELECT j."companyId", count(*)::int n FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL
      AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now())) GROUP BY 1),
    obs AS (SELECT e."canonicalEmployerId" id, json_agg(json_build_object('sourceKey', e."sourceKey", 'maison', so.maison, 'portalScope', so."portalScope") ORDER BY e."sourceKey") sources
      FROM (SELECT DISTINCT "canonicalEmployerId", "sourceKey" FROM "EmployerObservation" WHERE "canonicalEmployerId" IS NOT NULL) e
      JOIN "Source" so ON so.key = e."sourceKey" GROUP BY 1)
    SELECT c.id, c.name, c.kind::text kind, c."parentGroupId", coalesce(s.n, 0) servies, coalesce(o.sources, '[]'::json) sources,
      (SELECT j.url FROM "Job" j WHERE j."companyId" = c.id AND j.url LIKE 'https://%' ORDER BY j."isActive" DESC, j."lastSeenAt" DESC LIMIT 1) "evidenceUrl"
    FROM "Company" c LEFT JOIN servie s ON s."companyId" = c.id LEFT JOIN obs o ON o.id = c.id
    WHERE c."mergedIntoId" IS NULL ORDER BY c.id`);
}

export type MaisonGroup = { maison: string; maisonId: string | null; createKey: string | null;
  entities: Array<{ id: string; name: string; servies: number; evidenceUrl: string; sourceKeys: string[] }> };
export type MaisonPreview = { groups: MaisonGroup[]; uncertain: Array<{ entityId: string; name: string; maison: string; reason: string; servies: number }> };

export function maisonPreview(snapshot: Snapshot): MaisonPreview {
  const rows = new Map(snapshot.map(row => [row.id, row]));
  const results: MaisonAttachment[] = attachAll(snapshot);
  const groups = new Map<string, MaisonGroup>();
  const uncertain: MaisonPreview['uncertain'] = [];
  for (const result of results) {
    if (result.status === 'NOT_AN_ENTITY') continue;
    const entity = rows.get(result.entityId)!;
    if (result.status === 'UNCERTAIN') { uncertain.push({ entityId: entity.id, name: entity.name, maison: result.maison, reason: result.reason, servies: entity.servies }); continue; }
    // Une décision relue doit citer une page réelle où l'entité publie ; sans page, l'entité reste en revue.
    if (!entity.evidenceUrl) { uncertain.push({ entityId: entity.id, name: entity.name, maison: result.maison, reason: 'NO_EVIDENCE_URL', servies: entity.servies }); continue; }
    const key = result.maisonId ?? `new:${nameTokens(result.maison).join(' ')}`;
    const group = groups.get(key) ?? groups.set(key, { maison: result.maison, maisonId: result.maisonId,
      createKey: result.maisonId ? null : resolveCompany(result.maison).companyId, entities: [] }).get(key)!;
    group.entities.push({ id: entity.id, name: entity.name, servies: entity.servies, evidenceUrl: entity.evidenceUrl, sourceKeys: result.sourceKeys });
  }
  return { groups: [...groups.values()].sort((a, b) => a.maison.localeCompare(b.maison)), uncertain };
}

/** La décision relue d'une Maison : une preuve par entité (la page où elle publie, et ce qui la rattache). */
export function maisonRepairSpec(group: MaisonGroup, maisonId: string, reviewedAt: string): EmployerRepairSpec {
  const entities = [...group.entities].sort((a, b) => a.id.localeCompare(b.id));
  return {
    batchId: `r143-maison-${createHash('sha256').update(stable({ maisonId, entities: entities.map(e => e.id) })).digest('hex').slice(0, 24)}`,
    statement: `R-143 §5 : ${entities.length} entité(s) juridique(s) rattachée(s) à la Maison « ${group.maison} » — chaque source qui les nomme est inscrite au registre pour cette Maison, et leur nom prolonge le sien.`,
    reviewedBy: MAISON_REVIEWER, reviewedAt,
    evidence: entities.map(entity => {
      const artifactText = stable({ rule: 'REGISTRY_MAISON_AND_NAME_PREFIX', entity: { id: entity.id, name: entity.name }, maison: { id: maisonId, name: group.maison }, sourceKeys: entity.sourceKeys });
      return { url: entity.evidenceUrl, artifactText, sha256: createHash('sha256').update(artifactText).digest('hex'),
        explanation: `${entity.name} publie sur ${entity.sourceKeys.join(', ')}, sources inscrites pour ${group.maison}.` };
    }),
    merges: entities.map(entity => ({ fromId: entity.id, toId: maisonId })), aliases: [],
  };
}

async function maisonRow(db: PrismaClient, group: MaisonGroup): Promise<string> {
  if (group.maisonId) return group.maisonId;
  const key = group.createKey!;
  const existing = await db.company.findUnique({ where: { fashionjobsUrl: `resolved:${key}` } });
  if (existing) {
    // Une ligne déjà posée sous la clé du registre n'est reprise que si elle porte EXACTEMENT ce nom et n'est pas fusionnée.
    if (existing.mergedIntoId || nameTokens(existing.name).join(' ') !== nameTokens(group.maison).join(' ')) throw new Error(`MAISON_KEY_TAKEN key=${key}`);
    return existing.id;
  }
  return (await db.company.create({ data: { name: group.maison, canonicalKey: key, fashionjobsUrl: `resolved:${key}`, lastSeenAt: new Date() } })).id;
}

export async function attachMaisons(db: PrismaClient, options: { apply?: boolean; commitHash?: string; reviewedAt?: string } = {}) {
  const preview = maisonPreview(await employerSnapshot(db));
  const report = { maisons: preview.groups.length, entities: preview.groups.reduce((n, g) => n + g.entities.length, 0),
    toCreate: preview.groups.filter(g => !g.maisonId).map(g => g.maison), uncertain: preview.uncertain,
    applied: 0, movedJobs: 0, refused: [] as Array<{ maison: string; reason: string }> };
  if (!options.apply) return { ...report, groups: preview.groups };
  if (!options.commitHash) throw new Error('Applying Maison attachments requires the deployed commit hash');
  for (const group of preview.groups) {
    try {
      const maisonId = await maisonRow(db, group);
      const plan = await buildEmployerRepair(db, maisonRepairSpec(group, maisonId, options.reviewedAt ?? new Date().toISOString()));
      const result = await applyEmployerRepair(db, plan, digest(plan), options.commitHash);
      if (!result.alreadyApplied) report.applied++;
      report.movedJobs += result.movedJobs;
    } catch (error) {
      report.refused.push({ maison: group.maison, reason: error instanceof Error ? error.message.slice(0, 300) : String(error) });
    }
  }
  return report;
}
