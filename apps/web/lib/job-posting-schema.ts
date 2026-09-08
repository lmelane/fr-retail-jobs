import type { JobRow } from './jobs';
import { countryCode } from './countries';
import { siteUrl } from './site-url';
import { offerPath } from './offer-url';

/**
 * schema.org JobPosting for one offer (S-02a/S-02b intérim).
 *
 * Built from stored fields only — nothing invented, an absent field is
 * omitted. The parts Google Jobs actually gates on:
 *  - datePosted: the employer's original publication date. firstSeenAt is
 *    our discovery date and cannot substitute for this required Google field.
 *    Without a publication date the page remains available without JobPosting;
 *  - validThrough: the source's own expiry, omitted when unknown. Rendering
 *    the page does not establish a new application deadline;
 *  - employmentTerm: the schema.org enum, mapped from the normalized contract
 *    (CDI is not "CDI" for a crawler);
 *  - addressCountry: the canonical code of what the SOURCE said — never a
 *    hard-coded FR on a worldwide board (the audited S-02b bug), omitted when
 *    unknown;
 *  - identifier + directApply:false — we are an aggregator, the apply happens
 *    at the employer, and saying otherwise is the kind of lie that gets a
 *    board penalized.
 */

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

export function jobPostingSchema(job: JobRow): Record<string, unknown> | null {
  const datePosted = job.postedAt;
  if (!datePosted || !Number.isFinite(datePosted.getTime())) return null;
  const employmentTypes = schemaEmploymentTypes(job.employmentTerm, job.workTime, job.programType, job.engagementType);
  const country = countryCode(job.countryCode);

  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description ?? undefined,
    datePosted: datePosted.toISOString(),
    // An expired source date remains expired until new evidence corrects it.
    validThrough: job.validThrough?.toISOString(),
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
      job.salaryCurrency && (job.salaryMin !== null || job.salaryMax !== null)
        ? {
            '@type': 'MonetaryAmount',
            currency: job.salaryCurrency,
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
