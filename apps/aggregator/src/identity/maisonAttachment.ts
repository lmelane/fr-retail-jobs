import { normalizedEmployerName } from '../normalize/employerName.js';

/**
 * R-143 §5 (D-513) : « pour le candidat, Nike est Nike ». Une entité juridique (« PUMA Europe GmbH », « NIKE Retail UK »)
 * est rattachée à sa Maison par la fusion relue d'employeurs existante (`identity/repair.ts`) : l'entité reste une ligne
 * interne, ses libellés restent observés, et tout ce que voit le candidat (nom, filtre, facette, annuaire, suggestions,
 * alertes) lit la Maison, parce que chaque lecteur public lit l'employeur de l'offre.
 *
 * Le rattachement n'est JAMAIS deviné. Il exige deux preuves indépendantes, toutes deux relues :
 *  1. le REGISTRE : chaque source qui a nommé l'entité est inscrite au registre pour la même Maison (`Source.maison`) ;
 *  2. le NOM : le nom de l'entité commence par le nom complet de cette Maison, mot pour mot, et le prolonge (forme
 *     juridique, pays, succursale) ;
 * et au plus une ligne Maison, non fusionnée et qui n'est pas un groupe, porte exactement ce nom (si aucune ne le porte,
 * elle est créée sous la clé du registre, comme l'ingestion crée le propriétaire d'un portail).
 * Toute autre situation laisse l'entité à part et la signale en revue, avec son motif.
 */
export type EmployerRow = { id: string; name: string; kind: string; parentGroupId: string | null;
  sources: Array<{ sourceKey: string; maison: string | null; portalScope?: string | null }> };
export type MaisonAttachment =
  /** `maisonId` nul : aucune ligne ne porte encore le nom de la Maison du registre ; elle est créée à l'application. */
  | { status: 'ATTACHED'; entityId: string; maisonId: string | null; maison: string; sourceKeys: string[] }
  | { status: 'UNCERTAIN'; entityId: string; maison: string; reason: 'SOURCES_DISAGREE' | 'MAISON_ROW_AMBIGUOUS' | 'MAISON_IS_GROUP' | 'ENTITY_IS_GROUP' | 'PARENT_CONFLICT' | 'MAISON_ROW_IS_ENTITY' }
  | { status: 'NOT_AN_ENTITY'; entityId: string };

/** Les mots d'un nom, sans casse, accents conservés, ponctuation retirée : « PUMA Europe GmbH – Sede » → puma europe gmbh sede. */
export function nameTokens(name: string): string[] {
  return normalizedEmployerName(name).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
}
/** Le nom du registre, sans sa précision entre parenthèses (« LVMH (toutes Maisons) » → LVMH), comme `sourceSubjectKey`. */
export function registryMaison(maison: string | null): string | undefined {
  const name = maison?.split('(')[0].trim();
  return name || undefined;
}
const groupPortal = (source: EmployerRow['sources'][number]) => source.portalScope === 'MULTI_BRAND' || (source.maison ?? '').includes('(');
const startsWith = (tokens: string[], prefix: string[]) => prefix.length > 0 && prefix.every((token, i) => tokens[i] === token);

export function attachToMaison(entity: EmployerRow, maisonRows: readonly EmployerRow[]): MaisonAttachment {
  const tokens = nameTokens(entity.name);
  // Un portail de GROUPE ne désigne jamais une Maison : relu MULTI_BRAND (R-142 §3), ou inscrit avec sa précision
  // entre parenthèses (« LVMH (toutes Maisons) », « Tapestry (Coach, Kate Spade, Stuart Weitzman) »).
  const registry = [...new Set(entity.sources.filter(source => !groupPortal(source))
    .map(source => registryMaison(source.maison)).filter((m): m is string => !!m))];
  // L'entité n'est candidate que si son nom PROLONGE le nom d'une Maison du registre de ses propres sources.
  const claimed = registry.filter(maison => { const prefix = nameTokens(maison); return startsWith(tokens, prefix) && tokens.length > prefix.length; });
  if (!claimed.length) return { status: 'NOT_AN_ENTITY', entityId: entity.id };
  const maison = claimed.sort((a, b) => nameTokens(b).length - nameTokens(a).length)[0];
  const key = nameTokens(maison).join(' ');
  if (entity.kind === 'GROUP') return { status: 'UNCERTAIN', entityId: entity.id, maison, reason: 'ENTITY_IS_GROUP' };
  // Toutes les sources qui ont nommé l'entité doivent être inscrites pour cette Maison : un job board, un portail de
  // groupe ou une autre Maison qui la nomme suffit à suspendre le rattachement.
  if (entity.sources.some(source => groupPortal(source) || nameTokens(registryMaison(source.maison) ?? '').join(' ') !== key)) {
    return { status: 'UNCERTAIN', entityId: entity.id, maison, reason: 'SOURCES_DISAGREE' };
  }
  const rows = maisonRows.filter(row => row.id !== entity.id && nameTokens(row.name).join(' ') === key);
  if (!rows.length) return { status: 'ATTACHED', entityId: entity.id, maisonId: null, maison, sourceKeys: entity.sources.map(s => s.sourceKey).sort() };
  if (rows.length > 1) return { status: 'UNCERTAIN', entityId: entity.id, maison, reason: 'MAISON_ROW_AMBIGUOUS' };
  const target = rows[0];
  if (target.kind === 'GROUP') return { status: 'UNCERTAIN', entityId: entity.id, maison, reason: 'MAISON_IS_GROUP' };
  // La fusion relue refuse un parent qui diffère (`identity/repair.ts`) : on ne le découvre pas à l'application.
  if (entity.parentGroupId && entity.parentGroupId !== target.parentGroupId) return { status: 'UNCERTAIN', entityId: entity.id, maison, reason: 'PARENT_CONFLICT' };
  return { status: 'ATTACHED', entityId: entity.id, maisonId: target.id, maison: target.name, sourceKeys: entity.sources.map(s => s.sourceKey).sort() };
}

/** Toutes les entités d'un instantané des employeurs non fusionnés ; la ligne Maison elle-même n'est jamais rattachée. */
export function attachAll(rows: readonly EmployerRow[]): MaisonAttachment[] {
  const results = rows.map(row => attachToMaison(row, rows));
  // La fusion relue interdit les chaînes : une ligne Maison qui serait elle-même rattachée suspend ses entités.
  const attached = new Set(results.filter(r => r.status === 'ATTACHED').map(r => r.entityId));
  return results.map(r => r.status === 'ATTACHED' && r.maisonId && attached.has(r.maisonId)
    ? { status: 'UNCERTAIN', entityId: r.entityId, maison: r.maison, reason: 'MAISON_ROW_IS_ENTITY' } : r);
}
