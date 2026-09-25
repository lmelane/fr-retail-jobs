import { Prisma } from '@prisma/client';
import { storedAmount } from '@catwalks/db/money';
import type { CompiledOccupationTaxonomy } from '@catwalks/db/occupations';
import { classifyOccupationContent } from '../occupation/persist.js';
import { blockingKey, type CandidateJob } from '../dedup/match.js';
import { countryFromLocation, normalizeCountry } from '../normalize/country.js';
import { resolveGeography } from '../normalize/geography.js';
import { countryIntegrityOf } from '../normalize/countryIntegrity.js';
import { declaredPlaceVerdict } from '../normalize/declaredPlaceCountry.js';
import { cityFromLocation, displayCity } from '../normalize/location.js';
import { isFranceJob } from '../lib/france.js';
import { detectLanguage } from '../lib/language.js';
import { PIPELINE_VERSION } from '../pipeline/version.js';

/** Complete projection of one authoritative observation; shared by creation and reviewed repairs. */
export function publicationJobContent(candidate: CandidateJob, catalogue: CompiledOccupationTaxonomy) {
  const { countryCode: country, countryIntegrity, countryField } = countryWithProvenance(candidate);
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
    // Une subdivision n'existe que sous le pays retenu : sans pays (abstention), pas d'État non plus.
    adminArea1: country ? adminArea1Of(candidate, country, countryField) ?? null : null,
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
  /** Le champ pays sous lequel lire la subdivision : celui de la source, ou le pays qui l'a remplacé. */
  countryField: string | null | undefined;
} {
  const geo = resolveGeography({
    rawCountry: candidate.country,
    location: candidate.location,
    city: candidate.city,
  });
  const retained = retainedCountryOf(candidate, geo.countryCode);
  /*
   * D-440 / D-442 : LES LIEUX DÉCLARÉS DE LA PUBLICATION CONTRÔLENT LE PAYS RETENU, APRÈS TOUTE LA CHAÎNE.
   *
   * Un territoire qui a son marché, nommé sous le champ de son pays englobant, l'emporte (sous `CN`, Arc'teryx :
   * libellé « Hong Kong » ; LuxExperience : ville « Hong Kong SAR, China » ; sous `US`, Skechers : région « Puerto
   * Rico » ; Tapestry : libellé « San Juan, Puerto Rico, USA (…) »). Une publication qui se contredit prend le pays de son
   * adresse quand trois champs d'adresse au moins le nomment (Ulta : « United States », Caroline du Nord,
   * 28031 contre le code « PR »), et n'a sinon aucun pays : aucun repli ne peut rétablir l'un des deux.
   * Voir `normalize/declaredPlaceCountry.ts`.
   */
  const verdict = declaredPlaceVerdict({
    retained,
    countryField: candidate.country,
    locations: candidate.sourceFacts?.locations,
  });
  const countryCode = verdict.countryCode;
  switch (verdict.basis) {
    case 'RETAINED':
      // La preuve ne vaut que pour le pays effectivement retenu.
      return {
        countryCode,
        countryIntegrity: countryCode && countryCode === geo.countryCode ? countryIntegrityOf(geo, candidate.country) : null,
        countryField: candidate.country,
      };
    case 'ADDRESS':
      /*
       * Le pays vient du champ pays DÉDIÉ de l'adresse (« United States »), corroboré par deux champs au
       * moins : c'est la provenance `RAW_COUNTRY`, verdict rendu par le seul module qui en rend. Sans nom
       * de pays dans chaque lieu (État, code postal et libellé seuls), aucune preuve n'est persistée.
       */
      return {
        countryCode,
        countryIntegrity: verdict.countryName ? countryIntegrityOf({ countryCode, method: 'RAW_COUNTRY' }, verdict.countryName) : null,
        countryField: countryCode,
      };
    case 'TERRITORY':
      // Lu dans un nom de lieu (libellé, ville, région), jamais dans un champ pays : aucun verdict persisté (`countryIntegrity.ts`).
      return { countryCode, countryIntegrity: null, countryField: countryCode };
    case 'ABSTAINED':
      return { countryCode: undefined, countryIntegrity: null, countryField: undefined };
  }
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

/**
 * Resolve the subdivision using the country retained for this publication. When D-442 replaced the
 * source's country field, the subdivision is read under the replacing country, never under the code the
 * address contradicted (« PR » would refuse « North Carolina »).
 */
function adminArea1Of(candidate: CandidateJob, country: string | undefined, countryField: string | null | undefined): string | undefined {
  return resolveGeography({
    rawCountry: countryField,
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
