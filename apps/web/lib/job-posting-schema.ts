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
 *  - employmentTerm: the schema.org enum, mapped from the normalized contract
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

/**
 * Les dimensions d'emploi → l'énumération `employmentType` de schema.org, lue
 * par Google Jobs.
 *
 * Schema.org mélange dans UN seul champ ce que notre modèle sépare en quatre
 * dimensions : sa liste contient à la fois des rythmes (FULL_TIME, PART_TIME),
 * des durées (TEMPORARY), des dispositifs (INTERN) et des natures juridiques
 * (CONTRACTOR). C'est justement la confusion que notre base ne fait plus — mais
 * l'export SEO doit parler la langue du destinataire. La traduction se fait donc
 * ICI, à la frontière, et le modèle interne reste propre.
 *
 * Plusieurs valeurs sont légitimes pour une même offre (« PART_TIME » et
 * « TEMPORARY » pour un CDD à temps partiel) : schema.org accepte un tableau.
 */
export function schemaEmploymentTypes(
  employmentTerm: string | null,
  workTime: string | null,
  programType: string | null = null,
  engagementType: string | null = null,
): string[] {
  const types = new Set<string>();

  // Durée : seul le CDD/intérim a un équivalent — « PERMANENT » n'existe pas
  // dans l'énumération, où le permanent se déduit de l'absence de TEMPORARY.
  if (employmentTerm === 'FIXED_TERM' || employmentTerm === 'TEMPORARY') types.add('TEMPORARY');

  // Dispositif : stage et alternance sont « INTERN » pour Google.
  if (programType === 'INTERNSHIP' || programType === 'APPRENTICESHIP') types.add('INTERN');

  // Nature juridique : freelance et independent contractor partagent la même
  // valeur côté schema.org, faute de distinction dans son vocabulaire.
  if (engagementType === 'FREELANCE' || engagementType === 'INDEPENDENT_CONTRACTOR') types.add('CONTRACTOR');

  // Rythme — la dimension la mieux couverte par l'énumération.
  if (workTime === 'PART_TIME') types.add('PART_TIME');
  else if (workTime === 'FULL_TIME') types.add('FULL_TIME');

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
  const employmentTypes = schemaEmploymentTypes(job.employmentTerm, job.workTime, job.programType, job.engagementType);
  const country = countryCode(job.countryCode);

  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description ?? undefined,
    datePosted: datePosted.toISOString(),
    validThrough: validThrough.toISOString(),
    employmentType: employmentTypes.length ? employmentTypes : undefined,
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
