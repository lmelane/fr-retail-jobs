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
 * **Ce seuil est une règle CONSERVATRICE INTERNE de Mode Careers, pas un chiffre fourni par Google.** Google
 * exige une description complète du poste, sans en donner de longueur minimale. 100 caractères est notre choix :
 * il écarte les fragments (« Vendeur H/F », « Poste à pourvoir. ») sans écarter une annonce brève légitime.
 * Mesuré : 124 offres actives sans aucune description, 353 sous ce seuil, sur 78 932.
 */
const MIN_DESCRIPTION_LENGTH = 100;

/** Pourquoi une offre visible ne reçoit PAS de balisage. Une raison par condition réellement requise. */
export type MarkupIneligibility =
  | 'OPEN_APPLICATION'       // candidature spontanée : accessible, mais ce n'est pas un poste précis
  | 'NO_REAL_POSTED_DATE'    // aucune date de publication de l'employeur — et on n'en invente pas
  | 'NO_TITLE'
  | 'DESCRIPTION_TOO_THIN'   // absente ou réduite à un fragment
  | 'NO_HIRING_ORGANIZATION'
  | 'NO_USABLE_LOCATION'     // aucun lieu du tout : ni adresse, ni télétravail localisable
  /** Une adresse physique sans pays établi : `addressCountry` est requis, et on ne le devine pas. */
  | 'PHYSICAL_LOCATION_WITHOUT_COUNTRY'
  /** Un poste totalement distant sans aucun pays d'éligibilité connu. */
  | 'REMOTE_WITHOUT_ELIGIBILITY_COUNTRY'
  /** Le libellé de lieu contredit le `countryCode` canonique — « San Francisco, CA » sous le pays Canada. */
  | 'LOCATION_COUNTRY_CONFLICT'
  /** Multilocalisation dont le pays de chaque lieu n'est pas démontré, ou qui couvre plusieurs pays. */
  | 'MULTI_LOCATION_COUNTRY_NOT_PROVEN'
  /**
   * Le pays est un code AMBIGU dont la seule justification est le suffixe du libellé lui-même : une validation
   * circulaire. « El Segundo, CA » sous le pays `CA` ne prouve pas le Canada — `CA` y est la Californie.
   */
  | 'AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF'
  | 'VALID_THROUGH_EXPIRED'  // l'échéance de la source est passée : le poste se présente comme clos
  | 'NO_APPLY_PATH';         // aucun chemin de candidature exploitable

/**
 * Les codes qui sont À LA FOIS un code pays ISO 3166-1 et une subdivision américaine ou canadienne.
 *
 * C'est le cœur du correctif du 2026-09-11 : « San Francisco, CA; Seattle, WA; or San Diego, CA » portait
 * `countryCode = CA`, et le générateur publiait ces villes américaines sous `addressCountry: 'CA'` — le Canada.
 * Dans un `JobPosting`, `addressCountry` est un PAYS ; l'abréviation d'un état ne l'est pas.
 *
 * La liste vient de la même connaissance que `COLLIDING_CODES` du normaliseur géographique (D53), où elle avait
 * déjà envoyé 474 offres d'« Amsterdam, NH » à Terre-Neuve-et-Labrador.
 */
const COUNTRY_CODES_THAT_ARE_ALSO_SUBDIVISIONS = new Set([
  'CA', 'IN', 'AL', 'GA', 'KY', 'NC', 'SC', 'SD', 'NE', 'TN', 'MO', 'LA', 'MT',
  'ID', 'MS', 'PA', 'VA', 'DE', 'ME', 'AR', 'MD', 'MA', 'NV', 'CO', 'CT', 'IL',
  'MN', 'NL', 'ND', 'OM', 'OK', 'SK', 'PE', 'NU', 'WA', 'NH', 'MI', 'OH', 'RI', 'VT', 'WI', 'WY',
]);

/** Les codes d'États américains, pour reconnaître qu'un suffixe est COHÉRENT avec un pays déclaré `US`. */
const US_SUBDIVISION_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR',
]);

/** Les codes de provinces canadiennes, même usage. */
const CA_SUBDIVISION_CODES = new Set(['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT']);

/** Les suffixes d'un libellé qui désignent sans ambiguïté les États-Unis. */
const US_MARKERS = /\b(?:USA|U\.S\.A?\.?|United States)\b/i;

/**
 * Le suffixe à deux lettres d'un segment, quand il collisionne avec un code pays. « Seattle, WA » → `WA`.
 *
 * Sert à DÉTECTER un conflit, jamais à conclure que le pays est les États-Unis : une abréviation d'état n'est pas
 * une preuve de pays, et la déduire serait exactement le raccourci que ce correctif supprime.
 */
function collidingSuffix(segment: string): string | null {
  const tail = segment.split(',').pop()?.trim().replace(/\./g, '').toUpperCase() ?? '';
  return tail.length === 2 && COUNTRY_CODES_THAT_ARE_ALSO_SUBDIVISIONS.has(tail) ? tail : null;
}

/**
 * LA PREUVE DU PAYS EST-ELLE INDÉPENDANTE DU LIBELLÉ ? (correctif terminal P5, 2026-09-11)
 *
 * La règle précédente acceptait `suffix === country` comme « pas de conflit ». C'est une **validation
 * circulaire** quand le `countryCode` a lui-même été déduit de ce suffixe : « El Segundo, CA » sous le pays `CA`
 * se confirmait tout seul, et publiait une ville californienne au Canada.
 *
 * Mesuré en production : **1 936 offres** sont dans ce cas (suffixe ambigu égal au pays), et **aucune** ne porte
 * de nom de pays écrit en toutes lettres dans son `raw` — leur `countryCode` vient donc bien du seul suffixe.
 *
 * La preuve indépendante retenue, avec ce dont la page dispose réellement :
 *
 *   · `countryIntegrity` — la colonne prévue en D54 pour porter exactement ce jugement. Elle est vide
 *     aujourd'hui, mais la règle la lit : dès qu'une ingestion la renseignera, le verdict suivra sans nouveau
 *     correctif ;
 *   · un libellé qui NOMME le pays en toutes lettres (« …, United States », « …, Germany ») — indépendant du
 *     suffixe à deux lettres ;
 *   · un code postal, que le suffixe ne produit pas ;
 *   · un pays NON ambigu : `FR`, `IT`, `GB`… ne sont subdivision de rien, la question ne se pose pas.
 *
 * Ce qui n'est PAS une preuve : le suffixe lui-même, ni le fait qu'un `countryCode` existe en base.
 */
function hasIndependentCountryProof(job: JobRow, country: string, locality: string | undefined): boolean {
  // Un pays qui n'est pas un code collisionnant n'a pas besoin de preuve supplémentaire.
  if (!COUNTRY_CODES_THAT_ARE_ALSO_SUBDIVISIONS.has(country)) return true;

  /**
   * `countryIntegrity` porte le jugement de la chaîne d'ingestion : `OK` (ou tout verdict non douteux) vaut
   * preuve. Vide, elle ne prouve rien — mais elle ne réfute rien non plus, et les critères suivants s'appliquent.
   */
  const integrity = (job as { countryIntegrity?: string | null }).countryIntegrity;
  if (integrity && integrity !== 'AMBIGUOUS' && integrity !== 'UNVERIFIED') return true;

  // Le libellé nomme le pays en toutes lettres : indépendant du suffixe à deux lettres.
  const label = `${job.location ?? ''} ${locality ?? ''}`;
  if (spellsOutCountry(label, country)) return true;

  // Un code postal est une information que le suffixe ne fournit pas.
  if (job.postalCode?.trim()) return true;

  return false;
}

/**
 * Le libellé nomme-t-il le pays EN TOUTES LETTRES ? On ne reconnaît que les formes longues, jamais le code à
 * deux lettres — sinon on retomberait sur la circularité qu'on cherche à éliminer.
 */
const SPELLED_OUT: Readonly<Record<string, RegExp>> = {
  US: /\b(?:United States|USA|U\.S\.A\.)\b/i,
  CA: /\bCanada\b/i,
  DE: /\b(?:Germany|Deutschland|Allemagne)\b/i,
  IN: /\b(?:India|Inde)\b/i,
  MA: /\b(?:Morocco|Maroc)\b/i,
  NE: /\b(?:Niger)\b/i,
  LA: /\b(?:Laos)\b/i,
  PA: /\b(?:Panama)\b/i,
  ID: /\b(?:Indonesia|Indonésie)\b/i,
  IL: /\b(?:Israel|Israël)\b/i,
  NL: /\b(?:Netherlands|Pays-Bas|Nederland)\b/i,
  SK: /\b(?:Slovakia|Slovaquie)\b/i,
  AR: /\b(?:Argentina|Argentine)\b/i,
  CO: /\b(?:Colombia|Colombie)\b/i,
  MT: /\b(?:Malta|Malte)\b/i,
  MO: /\b(?:Macao|Macau)\b/i,
  AL: /\b(?:Albania|Albanie)\b/i,
  GA: /\b(?:Gabon)\b/i,
  MD: /\b(?:Moldova|Moldavie)\b/i,
  ME: /\b(?:Montenegro|Monténégro)\b/i,
  MS: /\b(?:Montserrat)\b/i,
  MN: /\b(?:Mongolia|Mongolie)\b/i,
  SC: /\b(?:Seychelles)\b/i,
  SD: /\b(?:Sudan|Soudan)\b/i,
  TN: /\b(?:Tunisia|Tunisie)\b/i,
  VA: /\b(?:Vatican)\b/i,
  KY: /\b(?:Cayman)\b/i,
  NC: /\b(?:New Caledonia|Nouvelle-Calédonie)\b/i,
};
function spellsOutCountry(label: string, country: string): boolean {
  return SPELLED_OUT[country]?.test(label) ?? false;
}

/**
 * Le libellé CONTREDIT-il le pays canonique ?
 *
 * Il y a conflit quand le suffixe est une subdivision d'un AUTRE pays que celui déclaré. « Seattle, WA » sous le
 * pays `CA` est un conflit ; « Berlin, DE » sous le pays `DE` n'en est pas un — `DE` y désigne l'Allemagne, le
 * suffixe et le pays disent la même chose.
 *
 * Mesuré avant cette distinction : 1 792 offres étaient signalées en conflit, dont **665 « …, DE » sous le pays
 * DE** et d'autres cas identiques — des libellés parfaitement cohérents. Signaler ceux-là aurait supprimé le
 * balisage de centaines d'offres correctes.
 */
function contradictsCountry(segment: string, country: string): boolean {
  const suffix = collidingSuffix(segment);
  if (!suffix) return false;
  // Le suffixe REDIT le pays déclaré : aucune contradiction (« Berlin, DE » sous DE).
  if (suffix === country) return false;
  /**
   * Le pays déclaré est celui dont ce suffixe EST une subdivision : cohérent. « Seattle, WA » sous `US` est
   * juste — WA est l'État de Washington, et le pays le confirme. C'est le cas normal du catalogue américain.
   */
  if (country === 'US' && US_SUBDIVISION_CODES.has(suffix)) return false;
  if (country === 'CA' && CA_SUBDIVISION_CODES.has(suffix)) return false;
  /**
   * Reste un suffixe qui n'est ni le pays déclaré, ni une subdivision de ce pays : « Seattle, WA » sous `DE`,
   * « San Francisco, CA » sous… le Canada. La localisation n'est pas prouvée.
   */
  return true;
}

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
   * La localisation est jugée par `resolveLocation`, la MÊME fonction que celle qui construit les propriétés du
   * balisage : la porte et le rendu ne peuvent pas divergir. Elle rend soit des lieux au pays établi, soit un
   * motif nommé — pays absent, conflit avec le libellé, ou pays non démontré sur une multilocalisation.
   */
  const location = resolveLocation(job);
  if (!location.ok) reasons.push(location.reason);
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
 * LA LOCALISATION DU BALISAGE — soit des lieux dont le pays est ÉTABLI, soit un refus nommé.
 *
 * Une seule fonction, appelée par la porte d'éligibilité ET par le générateur : deux expressions de cette règle
 * finiraient par divergir, et c'est précisément une divergence de ce genre qui a laissé publier des villes
 * américaines sous `addressCountry: 'CA'`.
 *
 * Les quatre situations que la version précédente traitait mal :
 *
 *   1. le `countryCode` global était appliqué à TOUS les segments d'une multilocalisation, sans vérifier qu'il
 *      leur correspond — « San Francisco, CA; Seattle, WA » sous le pays Canada ;
 *   2. une ville SANS pays suffisait à déclarer la localisation conforme — or `addressCountry` est requis ;
 *   3. un poste distant devenait éligible par sa ville seule, sans pays d'éligibilité ;
 *   4. des segments qui ne sont pas des villes (« or San Diego, CA », « Scotland », « United States ») étaient
 *      publiés comme `addressLocality`.
 *
 * Le principe retenu : **on ne publie que ce qui est prouvé, et on refuse en nommant le motif.** Jamais de pays
 * déduit d'une abréviation d'état, jamais de conjonction transformée en nom de ville.
 */
type LocationOutcome =
  | { ok: true; properties: Record<string, unknown> }
  | { ok: false; reason: MarkupIneligibility };

/** Les segments d'un libellé qui énumère plusieurs lieux, télétravail écarté. */
function enumeratedSegments(location: string | null | undefined): string[] {
  const raw = location?.trim();
  if (!raw?.includes(';')) return [];
  return raw.split(';')
    .map((segment) => segment.trim())
    /**
     * « Remote » n'est pas un LIEU. Mesuré sur les pages servies : « Lehi, Utah, United States; Remote »
     * publiait `addressLocality: "Remote"`, ce qui annonce à Google une ville qui n'existe pas. Le télétravail
     * est porté par `jobLocationType`, jamais par une adresse.
     */
    .filter((segment) => segment && !/^(remote|télétravail|teletravail|virtual|anywhere)$/i.test(segment));
}

/**
 * Un segment est-il publiable comme `addressLocality` ?
 *
 * Refusé : une conjonction laissée par l'énumération (« or San Diego, CA »), et un nom qui désigne un pays ou un
 * territoire entier plutôt qu'une localité (« United States », « Scotland »). Publier ceux-là comme localité
 * annoncerait à Google une ville qui n'existe pas.
 */
function publishableLocality(segment: string): boolean {
  if (/^\s*(?:or|and|ou|et)\b/i.test(segment)) return false;
  if (!segment.includes(',') && /^(united states|usa|scotland|england|wales|united kingdom|france|canada|europe|emea|apac|latam|worldwide|global)$/i.test(segment.trim())) return false;
  return true;
}

function resolveLocation(job: JobRow): LocationOutcome {
  const country = countryCode(job.countryCode);
  const segments = enumeratedSegments(job.location);
  const remote = job.workplaceType === 'REMOTE';

  // ── Multilocalisation ───────────────────────────────────────────────────────
  if (segments.length > 1) {
    /**
     * Chaque lieu doit avoir SON pays prouvé, ou appartenir à un ensemble dont le pays commun est établi. Or le
     * modèle ne porte qu'un `countryCode` global. On ne peut donc admettre une multilocalisation que si rien ne
     * contredit ce pays commun — et un suffixe d'état qui collisionne avec un code pays EST une contradiction.
     */
    if (!country) return { ok: false, reason: 'MULTI_LOCATION_COUNTRY_NOT_PROVEN' };
    if (segments.some((segment) => contradictsCountry(segment, country))) {
      return { ok: false, reason: 'LOCATION_COUNTRY_CONFLICT' };
    }
    // Un pays ambigu justifié par le seul suffixe ne prouve rien, même répété sur plusieurs segments.
    if (!hasIndependentCountryProof(job, country, segments[0])) {
      return { ok: false, reason: 'AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF' };
    }
    // Un libellé qui nomme plusieurs pays ne peut pas partager un pays commun.
    const namesUs = segments.some((segment) => US_MARKERS.test(segment));
    if (namesUs && country !== 'US') return { ok: false, reason: 'LOCATION_COUNTRY_CONFLICT' };
    const publishable = segments.filter(publishableLocality);
    if (publishable.length !== segments.length) return { ok: false, reason: 'MULTI_LOCATION_COUNTRY_NOT_PROVEN' };

    const places = publishable.map((segment) => ({
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: segment, addressCountry: country },
    }));
    return { ok: true, properties: {
      jobLocation: places.length > 1 ? places : places[0],
      ...(remote ? { jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { '@type': 'Country', name: country } } : {}),
    } };
  }

  // ── Poste totalement distant ────────────────────────────────────────────────
  if (remote) {
    /**
     * Un pays d'éligibilité RÉEL est exigé. Une ville seule ne suffit pas : elle ne dit pas depuis où l'on peut
     * candidater, et c'est justement ce que `applicantLocationRequirements` doit porter.
     */
    if (!country) return { ok: false, reason: 'REMOTE_WITHOUT_ELIGIBILITY_COUNTRY' };
    const locality = job.city?.trim() || segments[0];
    /** Le pays d'ÉLIGIBILITÉ doit être prouvé lui aussi : un `CA` tiré d'un suffixe ne dit pas « Canada ». */
    if (!hasIndependentCountryProof(job, country, locality)) {
      return { ok: false, reason: 'AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF' };
    }
    return { ok: true, properties: {
      jobLocationType: 'TELECOMMUTE',
      applicantLocationRequirements: { '@type': 'Country', name: country },
      // Le rattachement nommé par la source est conservé : c'est une information vraie.
      jobLocation: { '@type': 'Place', address: {
        '@type': 'PostalAddress',
        ...(locality && publishableLocality(locality) ? { addressLocality: locality } : {}),
        addressCountry: country,
      } },
    } };
  }

  // ── Un seul lieu physique ───────────────────────────────────────────────────
  const locality = job.city?.trim() || segments[0];
  if (!locality && !country) return { ok: false, reason: 'NO_USABLE_LOCATION' };
  /** `addressCountry` est requis : une ville sans pays n'est pas une localisation structurée fiable. */
  if (!country) return { ok: false, reason: 'PHYSICAL_LOCATION_WITHOUT_COUNTRY' };
  /** Et le libellé ne doit pas contredire ce pays — « Seattle, WA » n'est pas au Canada. */
  if (locality && contradictsCountry(locality, country)) {
    return { ok: false, reason: 'LOCATION_COUNTRY_CONFLICT' };
  }
  /**
   * Et le pays ne doit pas se justifier par le suffixe qu'on cherche justement à vérifier — « El Segundo, CA »
   * sous `CA`, « Indianapolis, IN » sous `IN`.
   */
  if (!hasIndependentCountryProof(job, country, locality)) {
    return { ok: false, reason: 'AMBIGUOUS_COUNTRY_WITHOUT_INDEPENDENT_PROOF' };
  }
  return { ok: true, properties: { jobLocation: { '@type': 'Place', address: {
    '@type': 'PostalAddress',
    ...(locality && publishableLocality(locality) ? { addressLocality: locality } : {}),
    ...(job.postalCode ? { postalCode: job.postalCode } : {}),
    // Canonical code of what the source said — NEVER a default.
    addressCountry: country,
  } } } };
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
    // Les propriétés de lieu, prouvées : la porte a déjà refusé tout ce qui ne l'était pas.
    ...(resolveLocation(job) as { ok: true; properties: Record<string, unknown> }).properties,
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
