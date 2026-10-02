import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { resolveCompany } from '../normalize/company.js';
import { digest, stable } from '../remediation/plan.js';
import { applyEmployerRepair, buildEmployerRepair, type EmployerRepairSpec } from './repair.js';
import { attachAll, nameTokens, type EmployerRow, type MaisonAttachment } from './maisonAttachment.js';
import { employerAliasKey } from '../normalize/employerName.js';

/**
 * R-143 §5 (D-513) : prévisualiser, puis appliquer, le rattachement des entités juridiques à leur Maison
 * (`maisonAttachment.ts`), une Maison par décision relue (`buildEmployerRepair` / `applyEmployerRepair`).
 *
 * Deux temps : l'aperçu n'écrit rien et rend le fichier à relire ; l'application n'applique QUE ce fichier, et refuse
 * sans rien écrire si l'aperçu recalculé en diffère. Elle crée, si elle manque, la ligne Maison sous la clé du registre
 * (comme l'ingestion crée le propriétaire d'un portail), puis fusionne chaque entité dans la Maison : l'entité reste,
 * fusionnée ; ses offres passent à la Maison ; ses libellés restent observés et retrouvables.
 */
export type Snapshot = Array<EmployerRow & { servies: number; toutes?: number; evidenceUrl: string | null; domain?: string | null;
  parentGroup?: string | null; sectorCodes?: string[]; fashionjobsUrl?: string; labels?: Array<{ sourceKey: string; label: string }> }>;
export const MAISON_REVIEWER = 'R-143 §5 — rattachement prouvé (registre des sources + nom), D-513, lecture D-492';
export const MAISON_FILE_KIND = 'r143-maisons/1';

/**
 * L'instantané lu par l'aperçu. Les sources d'une ligne comptent aussi celles des lignes déjà fusionnées dans elle (la
 * fusion relue les emporte), et chaque libellé publié par source sert d'alias relu pour les offres à venir.
 * La requête est aussi celle de `audits/2026-10-02/r143-dedoublonnage-maison/extraction-employeurs.sql`.
 */
export const EMPLOYER_SNAPSHOT_SQL = `
    WITH servie AS (SELECT j."companyId", count(*)::int n FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL
      AND EXISTS (SELECT 1 FROM "JobSource" s0 WHERE s0."jobId" = j.id AND s0."isActive" AND (s0."expiresAt" IS NULL OR s0."expiresAt" > now())) GROUP BY 1),
    toutes AS (SELECT "companyId", count(*)::int n FROM "Job" GROUP BY 1),
    seen AS (SELECT DISTINCT coalesce(ec."mergedIntoId", ec.id) id, e."sourceKey", e."rawEmployerName" label
      FROM "EmployerObservation" e JOIN "Company" ec ON ec.id = e."canonicalEmployerId"),
    obs AS (SELECT s.id, json_agg(DISTINCT jsonb_build_object('sourceKey', s."sourceKey", 'maison', so.maison, 'portalScope', so."portalScope")) sources,
      json_agg(DISTINCT jsonb_build_object('sourceKey', s."sourceKey", 'label', s.label)) labels
      FROM seen s JOIN "Source" so ON so.key = s."sourceKey" GROUP BY 1)
    SELECT c.id, c.name, c.kind::text kind, c."parentGroupId", c."parentGroup", c.domain, c."sectorCodes", c."fashionjobsUrl",
      coalesce(s.n, 0) servies, coalesce(t.n, 0) toutes, coalesce(o.sources, '[]'::json) sources, coalesce(o.labels, '[]'::json) labels,
      (SELECT j.url FROM "Job" j WHERE j."companyId" = c.id AND j.url LIKE 'https://%' ORDER BY j."isActive" DESC, j."lastSeenAt" DESC LIMIT 1) "evidenceUrl"
    FROM "Company" c LEFT JOIN servie s ON s."companyId" = c.id LEFT JOIN toutes t ON t."companyId" = c.id LEFT JOIN obs o ON o.id = c.id
    WHERE c."mergedIntoId" IS NULL ORDER BY c.id`;

export async function employerSnapshot(db: PrismaClient): Promise<Snapshot> {
  return db.$queryRawUnsafe<Snapshot>(EMPLOYER_SNAPSHOT_SQL);
}

export type MaisonGroup = { maison: string; maisonId: string | null; createKey: string | null;
  /** Ligne à créer seulement : le domaine que portent toutes ses entités (celui du site carrière), sinon nul. */
  createDomain: string | null;
  /** `labels` : les libellés que chaque source a publiés pour l'entité ; ils deviennent des alias relus vers la Maison,
   * pour qu'une offre à venir sous ce libellé aille à la Maison au lieu de recréer l'entité (`resolve.ts`). */
  entities: Array<{ id: string; name: string; servies: number; evidenceUrl: string; sourceKeys: string[]; labels: Array<{ sourceKey: string; label: string }> }> };
export type MaisonPreview = { kind: typeof MAISON_FILE_KIND; groups: MaisonGroup[];
  uncertain: Array<{ entityId: string; name: string; maison: string; reason: string; servies: number }> };

export function maisonPreview(snapshot: Snapshot): MaisonPreview {
  const rows = new Map(snapshot.map(row => [row.id, row]));
  const results: MaisonAttachment[] = attachAll(snapshot);
  const groups = new Map<string, MaisonGroup & { domains: Set<string | null> }>();
  const uncertain: MaisonPreview['uncertain'] = [];
  const apart = (entity: Snapshot[number], maison: string, reason: string) => uncertain.push({ entityId: entity.id, name: entity.name, maison, reason, servies: entity.servies });
  for (const result of results) {
    if (result.status === 'NOT_AN_ENTITY') continue;
    const entity = rows.get(result.entityId)!;
    if (result.status === 'UNCERTAIN') { apart(entity, result.maison, result.reason); continue; }
    // Une décision relue doit citer une page réelle où l'entité publie ; sans page, l'entité reste à part.
    if (!entity.evidenceUrl) { apart(entity, result.maison, 'NO_EVIDENCE_URL'); continue; }
    const target = result.maisonId ? rows.get(result.maisonId) : undefined;
    // L'API lit logo, secteurs et groupe sur la Maison : une Maison qui n'a pas ce que l'entité porte ferait perdre ses
    // offres au filtre secteur, à la facette groupe ou au logo. L'entité attend que la Maison soit qualifiée.
    if (target && !target.sectorCodes?.length && entity.sectorCodes?.length) { apart(entity, result.maison, 'MAISON_LACKS_SECTORS'); continue; }
    if (target && !target.domain && entity.domain) { apart(entity, result.maison, 'MAISON_LACKS_DOMAIN'); continue; }
    if (target && !target.parentGroup && entity.parentGroup) { apart(entity, result.maison, 'MAISON_LACKS_GROUP'); continue; }
    // La ligne à créer prendrait la clé du registre : si une autre ligne l'occupe déjà, on le dit dès l'aperçu.
    const createKey = result.maisonId ? null : resolveCompany(result.maison).companyId;
    if (createKey && snapshot.some(row => row.fashionjobsUrl === `resolved:${createKey}`)) { apart(entity, result.maison, 'MAISON_KEY_TAKEN'); continue; }
    const key = result.maisonId ?? `new:${nameTokens(result.maison).join(' ')}`;
    const group = groups.get(key) ?? groups.set(key, { maison: result.maison, maisonId: result.maisonId,
      createKey, createDomain: null, domains: new Set(), entities: [] }).get(key)!;
    group.domains.add(entity.domain ?? null);
    const labels = [...new Map((entity.labels ?? []).filter(l => result.sourceKeys.includes(l.sourceKey) && l.label?.trim())
      .map(l => [employerAliasKey(l.sourceKey, l.label), { sourceKey: l.sourceKey, label: l.label }])).values()]
      .sort((a, b) => employerAliasKey(a.sourceKey, a.label).localeCompare(employerAliasKey(b.sourceKey, b.label)));
    group.entities.push({ id: entity.id, name: entity.name, servies: entity.servies, evidenceUrl: entity.evidenceUrl, sourceKeys: result.sourceKeys, labels });
  }
  return { kind: MAISON_FILE_KIND, uncertain,
    groups: [...groups.values()].map(({ domains, ...group }) => {
      const known = [...domains].filter((d): d is string => !!d);
      return { ...group, createDomain: group.maisonId || new Set(known).size !== 1 ? null : known[0],
        entities: group.entities.sort((a, b) => a.id.localeCompare(b.id)) };
    }).sort((a, b) => a.maison.localeCompare(b.maison) || (a.maisonId ?? '').localeCompare(b.maisonId ?? '')) };
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
    merges: entities.map(entity => ({ fromId: entity.id, toId: maisonId })),
    aliases: [...new Map(entities.flatMap(entity => entity.labels).map(l => [employerAliasKey(l.sourceKey, l.label),
      { sourceKey: l.sourceKey, rawName: l.label, companyId: maisonId }])).values()],
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
  return (await db.company.create({ data: { name: group.maison, canonicalKey: key, fashionjobsUrl: `resolved:${key}`, kind: 'MAISON', lastSeenAt: new Date(),
    ...(group.createDomain ? { domain: group.createDomain, domainSource: 'source-careers' } : {}) } })).id;
}

/** Ce qui doit être identique entre le fichier relu et l'aperçu recalculé (les compteurs d'offres et la page de preuve vivent). */
const fingerprint = (groups: readonly MaisonGroup[]) => JSON.stringify(groups.map(g =>
  [g.maison, g.maisonId, g.createKey, g.createDomain, g.entities.map(e => [e.id, e.name, e.sourceKeys, e.labels])]));

export async function attachMaisons(db: PrismaClient, options: { reviewed?: MaisonPreview; commitHash?: string; reviewedAt?: string } = {}) {
  const preview = maisonPreview(await employerSnapshot(db));
  const report = { maisons: preview.groups.length, entities: preview.groups.reduce((n, g) => n + g.entities.length, 0),
    toCreate: preview.groups.filter(g => !g.maisonId).map(g => g.maison), uncertain: preview.uncertain,
    applied: 0, movedJobs: 0, refused: [] as Array<{ maison: string; reason: string }> };
  if (!options.reviewed) return { ...report, preview };
  // N'appliquer que le fichier relu : un aperçu qui a changé depuis la relecture refuse tout, avant toute écriture.
  if (options.reviewed.kind !== MAISON_FILE_KIND || !Array.isArray(options.reviewed.groups)) throw new Error('REVIEWED_PLAN_INVALID: a Maison preview file is required');
  if (fingerprint(preview.groups) !== fingerprint(options.reviewed.groups)) {
    throw new Error(`REVIEWED_PLAN_MISMATCH: the recomputed preview differs from the reviewed file (${preview.groups.length} Maisons now, ${options.reviewed.groups.length} reviewed); preview again`);
  }
  if (!options.commitHash) throw new Error('Applying Maison attachments requires the deployed commit hash');
  for (const group of options.reviewed.groups) {
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
