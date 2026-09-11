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

/**
 * La longueur minimale d'une description pour qu'un `JobPosting` ait un sens.
 *
 * Google exige une description complète du poste. Un fragment de quelques mots n'en est pas une : baliser une
 * page quasi vide, c'est promettre au moteur un contenu qui n'existe pas. Le seuil est volontairement bas — il
 * écarte les fragments, pas les annonces brèves. Mesuré : 124 offres actives sans aucune description, 353 sous
 * ce seuil, sur 78 932.
 */
const MIN_DESCRIPTION_LENGTH = 100;

/** Pourquoi une offre visible ne reçoit PAS de balisage. Une raison par condition réellement requise. */
export type MarkupIneligibility =
  | 'OPEN_APPLICATION'       // candidature spontanée : accessible, mais ce n'est pas un poste précis
  | 'NO_REAL_POSTED_DATE'    // aucune date de publication de l'employeur — et on n'en invente pas
  | 'NO_TITLE'
  | 'DESCRIPTION_TOO_THIN'   // absente ou réduite à un fragment
  | 'NO_HIRING_ORGANIZATION'
  | 'NO_USABLE_LOCATION'     // ni lieu physique, ni télétravail avec pays connu
  | 'VALID_THROUGH_EXPIRED'  // l'échéance de la source est passée : le poste se présente comme clos
  | 'NO_APPLY_PATH';         // aucun chemin de candidature exploitable

/**
 * Toutes les raisons pour lesquelles cette offre n'est pas éligible au balisage. Vide = éligible.
 *
 * Séparé de `jobPostingSchema` pour que la MESURE et le RENDU partagent exactement la même règle : un contrôle
 * qui réimplémenterait ces conditions finirait par diverger du balisage réellement émis.
 *
 * Corrigé le 2026-09-11 sur arbitrage du propriétaire. La version précédente n'exigeait qu'une `postedAt` : une
 * offre sans description, sans lieu, ou dont l'échéance était dépassée recevait quand même un `JobPosting`.
 * « Visible sur Mode Careers » et « éligible au balisage » sont deux questions différentes, et 77 482 était le
 * compte des offres actives datées — pas des offres éligibles.
 */
export function markupIneligibility(job: JobRow, now: Date = new Date()): MarkupIneligibility[] {
  const reasons: MarkupIneligibility[] = [];
  if (job.opportunityType === 'OPEN_APPLICATION') reasons.push('OPEN_APPLICATION');
  if (!job.postedAt || !Number.isFinite(job.postedAt.getTime())) reasons.push('NO_REAL_POSTED_DATE');
  if (!job.title?.trim()) reasons.push('NO_TITLE');
  if (!job.description || job.description.trim().length < MIN_DESCRIPTION_LENGTH) reasons.push('DESCRIPTION_TOO_THIN');
  if (!job.company?.trim()) reasons.push('NO_HIRING_ORGANIZATION');
  /**
   * Un lieu exploitable = une adresse physique (ville ou pays), OU un télétravail dont on connaît au moins le
   * pays, qui devient alors `applicantLocationRequirements`. Une offre sans l'un ni l'autre ne peut pas être
   * localisée, et Google refuse un `JobPosting` sans `jobLocation` ni `jobLocationType`.
   */
  const country = countryCode(job.countryCode);
  const physical = Boolean(job.city?.trim() || country);
  if (!physical) reasons.push('NO_USABLE_LOCATION');
  /**
   * Une échéance DÉPASSÉE annonce au moteur un poste clos. Tant qu'un run fiable n'a pas confirmé une nouvelle
   * échéance ou la fermeture, la page peut rester visible mais ne doit porter aucun balisage. On ne réécrit ni la
   * date ni l'historique : c'est la date de la source, elle reste telle quelle.
   */
  if (job.validThrough && job.validThrough.getTime() < now.getTime()) reasons.push('VALID_THROUGH_EXPIRED');
  if (!job.url || !/^https?:\/\//.test(job.url)) reasons.push('NO_APPLY_PATH');
  return reasons;
}

/**
 * Les lieux réellement énumérés par la source.
 *
 * Le modèle ne porte qu'UNE ville canonique par offre (`Job.city`), mais le libellé brut de la source
 * (`Job.location`) énumère parfois plusieurs lieux séparés par « ; » — « Hong Kong; Shanghai, Shanghai, China;
 * Shenzhen Shi, Guangdong, China ». Dans ce cas la colonne `city` a agrégé les noms en une chaîne qui n'est pas
 * une ville (« China Hong Kong Shanghai »), et publier CELLE-LÀ comme `addressLocality` serait faux.
 *
 * On repart donc du libellé quand il énumère, et on n'invente rien : chaque segment devient un `Place` avec ce
 * que le segment dit, pas plus.
 */
function physicalPlaces(job: JobRow, country: string | null): Array<Record<string, unknown>> {
  const raw = job.location?.trim();
  const segments = raw?.includes(';')
    ? raw.split(';').map((s) => s.trim()).filter(Boolean)
    : [];
  if (segments.length > 1) {
    return segments.map((segment) => ({
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        // Le segment tel que la source l'écrit : on ne tente pas d'en extraire une ville, ce serait deviner.
        addressLocality: segment,
        ...(country ? { addressCountry: country } : {}),
      },
    }));
  }
  if (!job.city?.trim() && !country) return [];
  return [{
    '@type': 'Place',
    address: {
      '@type': 'PostalAddress',
      addressLocality: job.city ?? undefined,
      postalCode: job.postalCode ?? undefined,
      // Canonical code of what the source said — NEVER a default.
      ...(country ? { addressCountry: country } : {}),
    },
  }];
}

/**
 * `jobLocation`, `jobLocationType` et `applicantLocationRequirements`, selon ce que la source fournit.
 *
 * Pour une offre totalement distante, Google demande `jobLocationType: 'TELECOMMUTE'` et, quand la restriction
 * géographique est connue, `applicantLocationRequirements`. Le pays normalisé est la seule restriction dont on
 * dispose réellement — on ne fabrique pas une région ou un état qui ne serait pas dans la donnée.
 */
function locationProperties(job: JobRow, country: string | null): Record<string, unknown> {
  const places = physicalPlaces(job, country);
  const single = places.length === 1 ? places[0] : undefined;
  const jobLocation = places.length > 1 ? places : single;

  if (job.workplaceType !== 'REMOTE') return { jobLocation };

  return {
    jobLocationType: 'TELECOMMUTE',
    /**
     * Un poste distant garde son `jobLocation` quand la source nomme un rattachement : Google l'accepte et c'est
     * une information vraie. Ce qui serait faux, c'est de prétendre un lieu que la source ne donne pas.
     */
    ...(jobLocation ? { jobLocation } : {}),
    ...(country ? { applicantLocationRequirements: { '@type': 'Country', name: country } } : {}),
  };
}

export function jobPostingSchema(job: JobRow, now: Date = new Date()): Record<string, unknown> | null {
  // Une seule porte, partagée avec la mesure : aucune condition n'est vérifiée deux fois à deux endroits.
  if (markupIneligibility(job, now).length > 0) return null;
  const datePosted = job.postedAt!;
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
    /**
     * LE LIEU, et ses trois cas — distincts, et à ne pas confondre (arbitrage du 2026-09-11) :
     *
     *   · UN lieu physique          → un objet `Place` ;
     *   · PLUSIEURS lieux physiques → un TABLEAU de `Place`, un par lieu réellement énuméré par la source ;
     *   · totalement distant        → `jobLocationType: 'TELECOMMUTE'` + `applicantLocationRequirements`
     *                                 quand la restriction géographique est connue.
     *
     * « Plusieurs sources » n'est PAS « plusieurs lieux » : la première notion compte des `JobSource`, la seconde
     * des adresses. Mesuré : 1 889 offres multi-sources contre 59 offres dont le libellé énumère réellement
     * plusieurs lieux (séparés par « ; »).
     */
    ...locationProperties(job, country),
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
