import type { DirectOffer } from '@prisma/client';
import { Prisma } from '@catwalks/db';
import { publicAmount } from '@catwalks/db/money';
import type { JobRow } from './jobs';

/**
 * L'ORIGINE DIRECTE DANS L'API (lot 6, D-423) — les offres publiées sur
 * Catwalks par une Maison, lues depuis la copie `DirectOffer` que le flux
 * d'outbox du backend alimente.
 *
 * Elles vivent dans un espace d'identifiants DISTINCT (`cw_<id>`) : un
 * identifiant public dit d'où vient l'offre, et un identifiant agrégé ne peut
 * jamais désigner une offre directe par collision. Une ligne directe est
 * servie avec le MÊME vocabulaire qu'une ligne agrégée (`JobRow`), plus son
 * origine et son action de candidature explicite.
 *
 * Une offre directe est PUBLIABLE quand le backend la dit publiée (`eligible`)
 * et que son échéance n'est pas passée ; sinon sa dernière projection reste
 * lisible par identifiant, comme une offre fermée (§4.13).
 */
export const PREFIXE_DIRECT = 'cw_';
export const SOURCE_DIRECTE = 'catwalks';

export const estIdDirect = (id: string): boolean => id.startsWith(PREFIXE_DIRECT);
export const idDirect = (idPublic: string): string => idPublic.slice(PREFIXE_DIRECT.length);
export const idPublicDirect = (id: string): string => `${PREFIXE_DIRECT}${id}`;

export function directPubliable(at = new Date()): Prisma.DirectOfferWhereInput {
  return { eligible: true, OR: [{ validThrough: null }, { validThrough: { gt: at } }] };
}

/** Only trusted, static SQL identifiers may be supplied as the alias. */
export function directPubliableSql(alias: Prisma.Sql, at = new Date()): Prisma.Sql {
  return Prisma.sql`${alias}.eligible AND (${alias}."validThrough" IS NULL OR ${alias}."validThrough" > ${at})`;
}

export function statutDirect(offre: Pick<DirectOffer, 'eligible' | 'validThrough'>, at = new Date()): 'active' | 'closed' {
  return offre.eligible && (!offre.validThrough || offre.validThrough > at) ? 'active' : 'closed';
}

export function directToRow(d: DirectOffer): JobRow {
  const min = d.salaryMin === null ? null : publicAmount(d.salaryMin);
  const max = d.salaryMax === null ? null : publicAmount(d.salaryMax);
  const salaire = !!d.salaryCurrency && !!d.salaryPeriod && (d.salaryMin === null || min !== null) && (d.salaryMax === null || max !== null);
  return {
    id: idPublicDirect(d.id),
    origine: 'CATWALKS',
    candidature: { type: 'CATWALKS', offreId: d.id, slug: d.slug, url: d.applyUrl },
    title: d.title,
    company: d.company,
    companyDomain: null,
    group: null,
    city: d.city,
    location: d.location,
    employmentTerm: d.employmentTerm,
    programType: d.programType,
    engagementType: d.engagementType,
    isSeasonal: null,
    sector: null,
    sectorCodes: d.sectorCodes,
    postedAt: d.postedAt,
    withdrawnAt: null,
    opportunityType: 'JOB_OPENING',
    latitude: d.latitude,
    longitude: d.longitude,
    sourceCount: 1,
    sources: [SOURCE_DIRECTE],
    description: d.description,
    applyUrl: d.applyUrl,
    sourceFacts: null,
    postalCode: d.postalCode,
    department: null,
    jobFunction: null,
    occupationCode: null,
    occupationLabel: d.occupationLabel,
    seniorityLabel: null,
    occupationFamilyLabel: null,
    occupationStatus: 'UNAVAILABLE',
    seniority: null,
    workTime: d.workTime,
    workplaceType: d.workplaceType,
    experienceYears: null,
    educationLevel: null,
    salaryMin: salaire ? min : null,
    salaryMax: salaire ? max : null,
    salaryCurrency: salaire ? d.salaryCurrency : null,
    salaryPeriod: salaire ? d.salaryPeriod : null,
    validThrough: d.validThrough,
    countryCode: d.countryCode,
    // Le pays vient du géocodage du propriétaire de l'offre, servi en code ISO : la provenance la plus directe qui existe.
    countryIntegrity: d.countryCode ? 'RAW_COUNTRY_CODE' : null,
    language: d.language,
    firstSeenAt: d.receivedAt,
  };
}
