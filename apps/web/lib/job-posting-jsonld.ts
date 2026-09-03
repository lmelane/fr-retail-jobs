import { countryCode } from './countries';
import type { JobRow } from './jobs';

/**
 * schema.org JobPosting pour une offre — extrait en fonction PURE pour être
 * testable (le composant page ne fait que l'injecter via safeJsonLd).
 *
 * Règle (fix/jsonld-address-country) : `addressCountry` vient du PAYS RÉEL de
 * l'offre, en ISO 3166-1 alpha-2 — jamais un « FR » par défaut. Une offre à
 * Milan qui déclare la France est une donnée structurée FAUSSE ; Google
 * pénalise le faux plus fort que l'absent. Donc :
 *   - code = countryCode(country brut) — alias connus → ISO ; sinon
 *     isFrance (drapeau fiable posé à l'ingest, D19) → 'FR' ; sinon null ;
 *   - null → `addressCountry` OMIS (un JSON-LD partiel est valide) ;
 *   - ni ville ni pays fiable → `jobLocation` entier OMIS ;
 *   - addressLocality / postalCode uniquement quand stockés.
 * Pas d'addressRegion : le champ `department` stocké est ambigu (il peut être
 * « Supply Chain », pas une région géographique) — on ne devine pas.
 */

type PostalAddress = {
  '@type': 'PostalAddress';
  addressLocality?: string;
  postalCode?: string;
  addressCountry?: string;
};

export type JobPostingJsonLd = {
  '@context': 'https://schema.org';
  '@type': 'JobPosting';
  title: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string;
  hiringOrganization: { '@type': 'Organization'; name: string };
  jobLocation?: { '@type': 'Place'; address: PostalAddress };
  baseSalary?: {
    '@type': 'MonetaryAmount';
    currency: string;
    value: {
      '@type': 'QuantitativeValue';
      minValue?: number;
      maxValue?: number;
      unitText?: string;
    };
  };
};

/** ISO alpha-2 du pays réel de l'offre, ou null quand rien de fiable n'est stocké. */
function isoCountry(job: JobRow): string | null {
  return countryCode(job.country) ?? (job.isFrance ? 'FR' : null);
}

export function buildJobPostingJsonLd(job: JobRow): JobPostingJsonLd {
  const country = isoCountry(job);

  // jobLocation seulement s'il existe AU MOINS un champ fiable (ville ou pays).
  const address: PostalAddress | null =
    job.city || country
      ? {
          '@type': 'PostalAddress',
          ...(job.city ? { addressLocality: job.city } : {}),
          ...(job.postalCode ? { postalCode: job.postalCode } : {}),
          ...(country ? { addressCountry: country } : {}),
        }
      : null;

  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    ...(job.description ? { description: job.description } : {}),
    ...(job.postedAt ? { datePosted: job.postedAt.toISOString() } : {}),
    ...(job.validThrough ? { validThrough: job.validThrough.toISOString() } : {}),
    ...(job.contract ? { employmentType: job.contract } : {}),
    hiringOrganization: { '@type': 'Organization', name: job.company },
    ...(address ? { jobLocation: { '@type': 'Place', address } } : {}),
    ...(job.salaryMin !== null || job.salaryMax !== null
      ? {
          baseSalary: {
            '@type': 'MonetaryAmount' as const,
            currency: job.salaryCurrency ?? 'EUR',
            value: {
              '@type': 'QuantitativeValue' as const,
              ...(job.salaryMin !== null ? { minValue: job.salaryMin } : {}),
              ...(job.salaryMax !== null ? { maxValue: job.salaryMax } : {}),
              ...(job.salaryPeriod ? { unitText: job.salaryPeriod } : {}),
            },
          },
        }
      : {}),
  };
}
