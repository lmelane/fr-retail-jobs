import { Prisma } from '@prisma/client';
import { storedAmount } from '@catwalks/db/money';
import type { CompiledOccupationTaxonomy } from '@catwalks/db/occupations';
import { classifyOccupationContent } from '../occupation/persist.js';
import { blockingKey, type CandidateJob } from '../dedup/match.js';
import { countryFromLocation, normalizeCountry } from '../normalize/country.js';
import { resolveGeography } from '../normalize/geography.js';
import { countryIntegrityOf } from '../normalize/countryIntegrity.js';
import { cityFromLocation, displayCity } from '../normalize/location.js';
import { isFranceJob } from '../lib/france.js';
import { detectLanguage } from '../lib/language.js';
import { PIPELINE_VERSION } from '../pipeline/version.js';

/** Complete projection of one authoritative observation; shared by creation and reviewed repairs. */
export function publicationJobContent(candidate: CandidateJob, catalogue: CompiledOccupationTaxonomy) {
  const { countryCode: country, countryIntegrity } = countryWithProvenance(candidate);
  const clusterKey = blockingKey(candidate);
  const taxonomy = classifyOccupationContent(candidate,catalogue);
  return {
    externalId: candidate.externalId,
    source: candidate.atsType ?? 'GENERIC_JSONLD' as const,
    title: candidate.title,
    opportunityType: candidate.opportunityType ?? null,
    description: candidate.description ?? null,
    location: candidate.location ?? null,
    countryCode: country ?? null,
    countryIntegrity,
    adminArea1: adminArea1Of(candidate, country) ?? null,
    city: cityOf(candidate) ?? null,
    postalCode: candidate.postalCode ?? null,
    latitude: candidate.latitude ?? null,
    longitude: candidate.longitude ?? null,
    rawContract: candidate.rawContract ?? null,
    rawWorkingTime: candidate.rawWorkingTime ?? null,
    employmentEvidence: candidate.employmentEvidence == null ? Prisma.DbNull : candidate.employmentEvidence as Prisma.InputJsonValue,
    employmentTerm: candidate.employmentTerm ?? null,
    engagementType: candidate.engagementType ?? null,
    isSeasonal: candidate.isSeasonal ?? null,
    workTime: candidate.workTime ?? null,
    workplaceType: candidate.workplaceType ?? null,
    workSchedule: candidate.workSchedule ?? null,
    rawSchedule: candidate.rawSchedule ?? null,
    experienceYears: candidate.experienceYears ?? null,
    educationLevel: candidate.educationLevel ?? null,
    salaryMin: storedAmount(candidate.salaryMin),
    salaryMax: storedAmount(candidate.salaryMax),
    salaryCurrency: candidate.salaryCurrency ?? null,
    salaryPeriod: candidate.salaryPeriod ?? null,
    department: candidate.department ?? null,
    validThrough: candidate.validThrough ?? null,
    language: candidate.language ?? detectLanguage(candidate.description ?? candidate.title),
    url: candidate.url,
    postedAt: candidate.postedAt ?? null,
    clusterKey,
    canonicalTier: candidate.sourceTier,
    canonicalSourceKey: candidate.sourceKey,
    canonicalExternalId: candidate.externalId,
    pipelineVersion: PIPELINE_VERSION,
    ...taxonomy,
    programType: candidate.programType ?? taxonomy.programType,
    raw: candidate.raw == null ? Prisma.DbNull : candidate.raw as Prisma.InputJsonValue,
  };
}

function countryWithProvenance(candidate: CandidateJob): {
  countryCode: string | undefined;
  countryIntegrity: string | null;
} {
  const geo = resolveGeography({
    rawCountry: candidate.country,
    location: candidate.location,
    city: candidate.city,
  });
  const countryCode = retainedCountryOf(candidate, geo.countryCode);
  // La preuve ne vaut que pour le pays effectivement retenu.
  const countryIntegrity = countryCode && countryCode === geo.countryCode
    ? countryIntegrityOf(geo, candidate.country)
    : null;
  return { countryCode, countryIntegrity };
}

function retainedCountryOf(candidate: CandidateJob, resolved: string | undefined): string | undefined {
  return (
    normalizeCountry(candidate.country) ??
    resolved ??
    countryFromLocation(candidate.location) ??
    // Un lieu que les signaux français reconnaissent (code postal, département,
    // région) sans pays nommé est en France : 440 offres actives « Paris (75) »
    // portaient isFrance sans pays (audit I-1, 2026-09-06).
    (isFranceJob(undefined, candidate.location) ? 'FR' : undefined)
  );
}

/** Resolve the subdivision using the country retained for this publication. */
function adminArea1Of(candidate: CandidateJob, country: string | undefined): string | undefined {
  return resolveGeography({
    rawCountry: candidate.country,
    location: candidate.location,
    city: candidate.city,
    legacyCountry: country,
  }).adminArea1;
}

/** Ville affichable — jamais un pays ou un code pays (« Ch », « Germany » : ~800 « villes », audit A1). */
function cityOf(candidate: CandidateJob): string | undefined {
  // La ville de l'adaptateur si elle est un lieu (location.ts rejette pays, états,
  // codes magasin, modes de travail), SINON celle que porte le lieu : +1 231
  // offres avec ville (lot 4). Pas de garde « ≠ pays » ici : elle effaçait
  // Singapour, Hong Kong, Luxembourg, Monaco (750 offres légitimes).
  return displayCity(candidate.city) ?? cityFromLocation(candidate.location);
}
