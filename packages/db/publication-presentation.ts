import { Prisma, type Job } from '@prisma/client';

/** A replaceable projection of one observation, never a source of publisher truth.
 * Lot F1 (2026-09-16) removed four projected fields (isFrance, adminArea2,
 * inseeCode, fingerprint) without a version bump: caches built before carry
 * them as extra keys, which `publicationContentOf` never reads nor spreads. */
export const PRESENTATION_VERSION = 'publication-presentation-20260915-v1';
export const PRESENTATION_FIELDS = [
  'externalId', 'source', 'title', 'opportunityType', 'description', 'location', 'countryCode', 'countryIntegrity',
  'adminArea1', 'city', 'postalCode', 'latitude', 'longitude',
  'rawContract', 'rawWorkingTime', 'employmentEvidence', 'employmentTerm', 'engagementType', 'isSeasonal',
  'workTime', 'workplaceType', 'workSchedule', 'rawSchedule', 'experienceYears', 'educationLevel',
  'salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod', 'department', 'validThrough', 'language',
  'url', 'postedAt', 'clusterKey', 'canonicalTier', 'canonicalSourceKey', 'canonicalExternalId',
  'pipelineVersion', 'rawTitle', 'programType',
] as const satisfies readonly (keyof Job)[];
export type PublicationContent = Pick<Job, typeof PRESENTATION_FIELDS[number]>;
export type PresentationSource = {
  sourceKey: string; externalId: string; url: string; sourceTier: string;
  captureBatchId?: string | null; captureOutputId?: string | null;
  sourceFacts?: unknown; presentation?: unknown;
};
const fields = new Map(Prisma.dmmf.datamodel.models.find(model => model.name === 'Job')!.fields.map(field => [field.name, field]));
const enums = new Map(Prisma.dmmf.datamodel.enums.map(item => [item.name, new Set(item.values.map(value => value.name))]));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Validate every projected field before hydrating database dates and decimals.
 * Unknown cache fields are never spread into an update or a public response. */
export function publicationContentOf(source: PresentationSource): PublicationContent | null {
  const cache = source.presentation;
  try {
    const url = new URL(source.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  } catch { return null; }
  if (!object(cache) || cache.version !== PRESENTATION_VERSION || !object(cache.values) ||
    typeof cache.readerVersion !== 'string' || !cache.readerVersion ||
    cache.sourceKey !== source.sourceKey || cache.externalId !== source.externalId || cache.url !== source.url ||
    cache.captureBatchId !== (source.captureBatchId ?? null) || cache.captureOutputId !== (source.captureOutputId ?? null) ||
    (source.sourceFacts != null && (!object(source.sourceFacts) || cache.inputHash !== source.sourceFacts.inputHash)) ||
    typeof cache.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(cache.inputHash)) return null;
  const result: Record<string, unknown> = {};
  for (const key of PRESENTATION_FIELDS) {
    const value = cache.values[key], field = fields.get(key)!;
    if (value === undefined || value === null && field.isRequired) return null;
    if (value === null) { result[key] = null; continue; }
    if (field.kind === 'enum') {
      if (typeof value !== 'string' || !enums.get(field.type)?.has(value)) return null;
      result[key] = value;
    } else if (field.type === 'DateTime') {
      if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return null;
      result[key] = new Date(value);
    } else if (field.type === 'Decimal') {
      if (typeof value !== 'string' || !/^\d{1,18}(?:\.\d{1,6})?$/.test(value)) return null;
      result[key] = new Prisma.Decimal(value);
    } else if (field.type === 'String') {
      if (typeof value !== 'string') return null;
      result[key] = value;
    } else if (field.type === 'Boolean') {
      if (typeof value !== 'boolean') return null;
      result[key] = value;
    } else if (field.type === 'Int' || field.type === 'Float') {
      if (typeof value !== 'number' || !Number.isFinite(value) ||
        field.type === 'Int' && !Number.isInteger(value) ||
        (field.type === 'Int' || key === 'experienceYears') && (value < -2147483648 || value > 2147483647)) return null;
      result[key] = value;
    } else if (field.type === 'Json') {
      result[key] = value;
    } else return null;
  }
  if (result.externalId !== source.externalId || result.canonicalExternalId !== source.externalId ||
    result.canonicalSourceKey !== source.sourceKey || result.url !== source.url || !(result.title as string).trim()) return null;
  return { ...result, canonicalTier: source.sourceTier } as PublicationContent;
}
