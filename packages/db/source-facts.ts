/** Derived, rebuildable cache. Immutable publisher inputs live in the capture store. */
export const FACT_READER_VERSION = 'source-facts-20260915-v1';
export type FactStatus = 'DECLARED' | 'NOT_OBSERVED' | 'INPUT_MISSING' | 'UNINTERPRETED' | 'INVALID' | 'CONFLICT' | 'WITHHELD_BY_SOURCE';
export type Evidence = { path: string; value: unknown };
export type Fact<T> = { status: FactStatus; value: T | null; evidence: Evidence[]; issues: string[] };
export type SalaryBand = { min: string | null; max: string | null; currency: string | null; period: string | null;
  nativePeriod: string | null; basis: string | null; label: string | null };
export type SalaryValue = { bands: SalaryBand[]; terms: string[] };
export type WorkplaceMode = 'ONSITE' | 'HYBRID' | 'REMOTE' | 'OCCASIONAL_REMOTE';
export type WorkplaceValue = { modes: WorkplaceMode[]; nativeLabels: string[] };
export type EducationValue = { referential: string; requirements: string[]; noDiplomaRequired: boolean };
export type SourceLocation = { path: string; label: string | null; city: string | null; region: string | null;
  postalCode: string | null; country: string | null; latitude: number | null; longitude: number | null;
  coordinateStatus: FactStatus; issues: string[] };
export type SourceFacts = { version: typeof FACT_READER_VERSION; sourceType: string; inputHash: string;
  salary: Fact<SalaryValue>; workplace: Fact<WorkplaceValue>; education: Fact<EducationValue>; locations: Fact<SourceLocation[]> };

/** No RAW values or internal paths in the public response. Exact decimal amounts remain strings. */
export type PublicSourceFacts = Pick<SourceFacts, 'version' | 'sourceType'> & {
  [K in 'salary' | 'workplace' | 'education']: Omit<SourceFacts[K], 'evidence'>;
} & { locations: Omit<Fact<Array<Omit<SourceLocation, 'path'>>>, 'evidence'> };

const STATUSES = new Set<FactStatus>(['DECLARED','NOT_OBSERVED','INPUT_MISSING','UNINTERPRETED','INVALID','CONFLICT','WITHHELD_BY_SOURCE']);
const nullableText = (value: unknown) => value === null || typeof value === 'string';
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const amount = (value: unknown) => value === null || typeof value === 'string' && /^\d{1,18}(?:\.\d{1,6})?$/.test(value);

export function publicSourceFacts(raw: unknown): PublicSourceFacts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const facts = raw as SourceFacts;
  if (facts.version !== FACT_READER_VERSION || typeof facts.sourceType !== 'string' || !/^[a-f0-9]{64}$/.test(facts.inputHash)) return null;
  for (const key of ['salary','workplace','education','locations'] as const) {
    const fact = facts[key];
    if (!fact || !STATUSES.has(fact.status) || !strings(fact.issues) ||
      (fact.status === 'DECLARED' ? fact.value === null || typeof fact.value !== 'object' : fact.value !== null)) return null;
  }
  const salary = facts.salary.value;
  if (salary && (!strings(salary.terms) || !Array.isArray(salary.bands) || !salary.bands.every(band => band &&
    amount(band.min) && amount(band.max) && [band.currency,band.period,band.nativePeriod,band.basis,band.label].every(nullableText)))) return null;
  const workplace = facts.workplace.value;
  if (workplace && (!strings(workplace.modes) || !workplace.modes.every(mode => ['REMOTE','ONSITE','HYBRID','OCCASIONAL_REMOTE'].includes(mode)) || !strings(workplace.nativeLabels))) return null;
  const education = facts.education.value;
  if (education && (typeof education.referential !== 'string' || !strings(education.requirements) || typeof education.noDiplomaRequired !== 'boolean')) return null;
  const locations = facts.locations.value;
  if (locations && (!Array.isArray(locations) || !locations.every(location => location &&
    [location.label,location.city,location.region,location.postalCode,location.country].every(nullableText) && strings(location.issues) &&
    STATUSES.has(location.coordinateStatus) && (location.latitude === null && location.longitude === null ||
      typeof location.latitude === 'number' && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 &&
      typeof location.longitude === 'number' && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180)))) return null;
  const clean = <T>(fact: Fact<unknown>, value: T | null) => ({ status: fact.status, value, issues: [...fact.issues] });
  // Pick every public field explicitly: a malformed or newer cache may contain private extras.
  return { version: facts.version, sourceType: facts.sourceType,
    salary: clean(facts.salary, salary ? { terms: [...salary.terms], bands: salary.bands.map(band => ({
      min: band.min, max: band.max, currency: band.currency, period: band.period,
      nativePeriod: band.nativePeriod, basis: band.basis, label: band.label,
    })) } : null),
    workplace: clean(facts.workplace, workplace ? { modes: [...workplace.modes], nativeLabels: [...workplace.nativeLabels] } : null),
    education: clean(facts.education, education ? { referential: education.referential,
      requirements: [...education.requirements], noDiplomaRequired: education.noDiplomaRequired } : null),
    locations: clean(facts.locations, locations?.map(location => ({ label: location.label, city: location.city,
      region: location.region, postalCode: location.postalCode, country: location.country,
      latitude: location.latitude, longitude: location.longitude, coordinateStatus: location.coordinateStatus,
      issues: [...location.issues] })) ?? null) };
}

/** Shared scalar projection: one publication, no mixing of amounts, places or modes. */
export function scalarSourceFacts(facts: SourceFacts | PublicSourceFacts | null) {
  const salary = facts?.salary.status === 'DECLARED' && facts.salary.value?.bands.length === 1 ? facts.salary.value.bands[0] : null;
  const education = facts?.education.status === 'DECLARED' ? facts.education.value : null;
  const modes = facts?.workplace.status === 'DECLARED' ? facts.workplace.value?.modes : null;
  const locations = facts?.locations.status === 'DECLARED' ? facts.locations.value : null;
  const location = locations?.length === 1 ? locations[0] : null;
  return {
    salaryMin: salary?.min ?? null, salaryMax: salary?.max ?? null, salaryCurrency: salary?.currency ?? null, salaryPeriod: salary?.period ?? null,
    educationLevel: education?.requirements.length === 1 ? `${education.referential}:${education.requirements[0]}` : null,
    workplaceType: modes?.length === 1 && modes[0] !== 'OCCASIONAL_REMOTE' ? modes[0] : null,
    latitude: location?.latitude ?? null, longitude: location?.longitude ?? null, postalCode: location?.postalCode ?? null,
  };
}
