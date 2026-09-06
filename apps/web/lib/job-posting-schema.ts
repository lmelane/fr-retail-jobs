import type { JobRow } from './jobs';
import { countryCode } from './countries';
import { siteUrl } from './site-url';
import { offerPath } from './offer-url';

/**
 * schema.org JobPosting for one offer (S-02a/S-02b intérim).
 *
 * Built from stored fields only — nothing invented, an absent field is
 * omitted. The parts Google Jobs actually gates on:
 *  - datePosted: postedAt when the source ships it, else firstSeenAt — the
 *    honest first sighting, made stable by D22 (no more churn);
 *  - validThrough: the source's own expiry, else a 60-day horizon from
 *    datePosted — a fallback, refreshed as long as the offer is re-listed,
 *    and the 410 kills the page when it closes for real;
 *  - employmentType: the schema.org enum, mapped from the normalized contract
 *    (CDI is not "CDI" for a crawler);
 *  - addressCountry: the canonical code of what the SOURCE said — never a
 *    hard-coded FR on a worldwide board (the audited S-02b bug), omitted when
 *    unknown;
 *  - identifier + directApply:false — we are an aggregator, the apply happens
 *    at the employer, and saying otherwise is the kind of lie that gets a
 *    board penalized.
 */

/** Horizon de validité d'une offre encore listée : le prochain passage, avec marge (cadence quotidienne, D36). */
const VALID_THROUGH_HORIZON_DAYS = 30;

/** Normalized contract/working time -> schema.org employmentType values. */
export function schemaEmploymentTypes(
  contract: string | null,
  workingTime: string | null,
): string[] {
  const types = new Set<string>();
  // The normalizer's ContractType union (aggregator normalize/contract.ts).
  switch (contract) {
    case 'CDI': case 'GRADUATE': types.add('FULL_TIME'); break;
    case 'CDD': case 'INTERIM': case 'VIE': types.add('TEMPORARY'); break;
    case 'STAGE': case 'ALTERNANCE': types.add('INTERN'); break;
    case 'FREELANCE': types.add('CONTRACTOR'); break;
    default: break;
  }
  if (workingTime === 'TEMPS_PARTIEL') {
    types.add('PART_TIME');
    types.delete('FULL_TIME');
  } else if (workingTime === 'TEMPS_PLEIN') {
    types.add('FULL_TIME');
  }
  return [...types];
}

export function jobPostingSchema(job: JobRow, now = new Date()): Record<string, unknown> {
  const datePosted = job.postedAt ?? job.firstSeenAt;
  /**
   * Une offre encore listée par son ATS est valide : sa validité ne doit jamais
   * être dans le passé, sinon Google Jobs l'écarte — 21 157 offres actives
   * (29 %) publiaient une validité dépassée par le repli « publication + 60 j »
   * (audit A4, 2026-09-06 ; décision Loïc : « si l'offre est encore dans l'ATS,
   * on met à jour »). La validité de la source est gardée tant qu'elle est
   * future ; sinon l'horizon du prochain passage : aujourd'hui + 30 jours.
   * Une offre fermée n'émet pas de JSON-LD (D22).
   */
  const horizon = new Date(now.getTime() + VALID_THROUGH_HORIZON_DAYS * 86_400_000);
  const validThrough = job.validThrough && job.validThrough.getTime() > now.getTime() ? job.validThrough : horizon;
  const employmentType = schemaEmploymentTypes(job.contract, job.workingTime);
  const country = countryCode(job.country);

  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description ?? undefined,
    datePosted: datePosted.toISOString(),
    validThrough: validThrough.toISOString(),
    employmentType: employmentType.length ? employmentType : undefined,
    identifier: { '@type': 'PropertyValue', name: job.company, value: job.id },
    hiringOrganization: { '@type': 'Organization', name: job.company },
    // The candidate applies at the employer, not on this page (D18).
    directApply: false,
    url: `${siteUrl()}${offerPath(job)}`,
    ...(job.language ? { inLanguage: job.language } : {}),
    jobLocation:
      job.city || country
        ? {
            '@type': 'Place',
            address: {
              '@type': 'PostalAddress',
              addressLocality: job.city ?? undefined,
              postalCode: job.postalCode ?? undefined,
              // Canonical code of what the source said — NEVER a default.
              ...(country ? { addressCountry: country } : {}),
            },
          }
        : undefined,
    baseSalary:
      job.salaryMin !== null || job.salaryMax !== null
        ? {
            '@type': 'MonetaryAmount',
            currency: job.salaryCurrency ?? 'EUR',
            value: {
              '@type': 'QuantitativeValue',
              minValue: job.salaryMin ?? undefined,
              maxValue: job.salaryMax ?? undefined,
              unitText: job.salaryPeriod ?? undefined,
            },
          }
        : undefined,
  };
}
