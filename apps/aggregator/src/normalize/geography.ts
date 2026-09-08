/**
 * GÉOGRAPHIE MONDIALE — countryCode · city · adminArea1 · adminArea2.
 *
 * Modèle validé par Loïc le 2026-09-08, à partir de la mesure des 71 636 offres.
 *
 * Ce qu'on ne fait PAS, et pourquoi :
 *  - pas de colonne `continent` : « Europe », « Asia Pacific » sont des
 *    macro-régions BUSINESS, dérivables du pays le jour où le besoin existe.
 *    Les mettre dans `adminArea1` mélangerait deux niveaux conceptuels, comme
 *    `contract` mélangeait quatre concepts.
 *  - pas de colonne par identifiant national : `inseeCode` (code communal
 *    français, 2 750 offres sur 2 770) vit dans `locationIdentifiers`, une
 *    structure qui accueillera les suivants sans ajouter de colonne par pays.
 *
 * RÈGLE CARDINALE : **une géographie incomplète mais certaine vaut mieux qu'une
 * géographie complète inventée.**
 */

/** D'où vient le pays — la provenance, conservée pour l'audit. */
export type GeoMethod =
  | 'RAW_COUNTRY_CODE'
  | 'RAW_COUNTRY'
  | 'LOCATION_COUNTRY_PREFIX'
  | 'LOCATION_COUNTRY_NAME'
  | 'LOCATION_ADMIN1_SUFFIX';

export type ResolvedGeography = {
  countryCode?: string;
  city?: string;
  adminArea1?: string;
  /** Nullable, et jamais rempli artificiellement pour justifier la colonne. */
  adminArea2?: string;
  method?: GeoMethod;
  sourcePath?: string;
  confidence?: number;
};

export type GeographyInput = {
  /** Le champ pays de la source, si elle en expose un. */
  rawCountry?: string | null;
  rawCountryCode?: string | null;
  /**
   * Le pays DÉJÀ stocké, s'il existe. Sert uniquement d'arbitre pour les codes
   * qui collisionnent (« Berlin, DE ») : quand le legacy dit un pays valide et
   * que la lecture « subdivision US » n'est qu'une hypothèse, on ne corrige pas.
   */
  legacyCountry?: string | null;
  /** Le libellé de lieu brut — le gisement principal (6 326 offres mesurées). */
  location?: string | null;
  /** La ville déjà extraite par l'adaptateur, quand elle existe. */
  city?: string | null;
};

/**
 * Les subdivisions des pays fédéraux, par leur CODE.
 *
 * Indispensable pour lever l'ambiguïté mesurée : `TN`, `GA`, `SC`, `NE`, `MO`,
 * `KY`, `NC`, `SD` sont à la fois des états américains et des codes ISO pays
 * (Tunisie, Gabon, Seychelles, Niger, Macao, Cayman, Nouvelle-Calédonie,
 * Soudan). En base, « Nashville, TN » était devenu le pays « TN ».
 *
 * Le code seul ne tranche jamais : c'est sa POSITION (suffixe d'un libellé de
 * lieu, après une ville) qui en fait une subdivision.
 */
const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/** Les provinces canadiennes — même ambiguïté (`ON`, `QC`, `BC`, `NS`…). */
const CA_PROVINCES: Record<string, string> = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories',
  NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec',
  SK: 'Saskatchewan', YT: 'Yukon',
};

/**
 * Les noms de pays acceptés, dans les langues que les sources emploient.
 * Mesurés, pas imaginés : « Italia », « Deutschland », « España » apparaissent
 * réellement dans les libellés de lieu.
 */
const COUNTRY_NAMES: Record<string, string> = {
  FRANCE: 'FR', 'UNITED STATES': 'US', USA: 'US', 'UNITED STATES OF AMERICA': 'US',
  'ETATS-UNIS': 'US', 'UNITED KINGDOM': 'GB', UK: 'GB', 'GRANDE-BRETAGNE': 'GB',
  ANGLETERRE: 'GB', ENGLAND: 'GB', SCOTLAND: 'GB', WALES: 'GB',
  GERMANY: 'DE', DEUTSCHLAND: 'DE', ALLEMAGNE: 'DE',
  ITALY: 'IT', ITALIA: 'IT', ITALIE: 'IT',
  SPAIN: 'ES', ESPANA: 'ES', ESPAGNE: 'ES',
  JAPAN: 'JP', JAPON: 'JP', CANADA: 'CA', CHINA: 'CN', CHINE: 'CN',
  NETHERLANDS: 'NL', 'PAYS-BAS': 'NL', BELGIUM: 'BE', BELGIQUE: 'BE',
  SWITZERLAND: 'CH', SUISSE: 'CH', AUSTRIA: 'AT', AUTRICHE: 'AT',
  PORTUGAL: 'PT', IRELAND: 'IE', IRLANDE: 'IE', SWEDEN: 'SE', SUEDE: 'SE',
  DENMARK: 'DK', DANEMARK: 'DK', NORWAY: 'NO', NORVEGE: 'NO',
  POLAND: 'PL', POLOGNE: 'PL', AUSTRALIA: 'AU', AUSTRALIE: 'AU',
  SINGAPORE: 'SG', SINGAPOUR: 'SG', SEYCHELLES: 'SC', TUNISIA: 'TN', TUNISIE: 'TN',
  MEXICO: 'MX', MEXIQUE: 'MX', BRAZIL: 'BR', BRESIL: 'BR', INDIA: 'IN', INDE: 'IN',
  'SOUTH KOREA': 'KR', 'COREE DU SUD': 'KR', 'HONG KONG': 'HK', MACAO: 'MO',
  'UNITED ARAB EMIRATES': 'AE', 'EMIRATS ARABES UNIS': 'AE',
  ARGENTINA: 'AR', ARGENTINE: 'AR', CHILE: 'CL', CHILI: 'CL', PERU: 'PE', PEROU: 'PE',
  COLOMBIA: 'CO', COLOMBIE: 'CO', 'NEW ZEALAND': 'NZ', 'NOUVELLE-ZELANDE': 'NZ',
  THAILAND: 'TH', THAILANDE: 'TH', MALAYSIA: 'MY', MALAISIE: 'MY',
  INDONESIA: 'ID', INDONESIE: 'ID', PHILIPPINES: 'PH', TAIWAN: 'TW',
  VIETNAM: 'VN', TURKEY: 'TR', TURKIYE: 'TR', TURQUIE: 'TR',
  GREECE: 'GR', GRECE: 'GR', 'CZECH REPUBLIC': 'CZ', TCHEQUIE: 'CZ',
  HUNGARY: 'HU', HONGRIE: 'HU', ROMANIA: 'RO', ROUMANIE: 'RO',
  SLOVAKIA: 'SK', SLOVAQUIE: 'SK', LUXEMBOURG: 'LU', MONACO: 'MC',
  MOROCCO: 'MA', MAROC: 'MA', 'SOUTH AFRICA': 'ZA', 'AFRIQUE DU SUD': 'ZA',
  FINLAND: 'FI', FINLANDE: 'FI', 'SAUDI ARABIA': 'SA', 'ARABIE SAOUDITE': 'SA',
  QATAR: 'QA', ISRAEL: 'IL', RUSSIA: 'RU', RUSSIE: 'RU', UKRAINE: 'UA',
  'PUERTO RICO': 'PR', BULGARIA: 'BG', BULGARIE: 'BG', CROATIA: 'HR', CROATIE: 'HR',
  SLOVENIA: 'SI', SLOVENIE: 'SI', SERBIA: 'RS', SERBIE: 'RS', ESTONIA: 'EE',
  LATVIA: 'LV', LETTONIE: 'LV', LITHUANIA: 'LT', LITUANIE: 'LT',
};

/**
 * Les codes NON ISO que les sources emploient malgré tout. `UK` est le cas
 * mesuré (20 offres) : le code officiel du Royaume-Uni est `GB`, mais `UK` est
 * l'usage courant. Normaliser ici évite deux clés pour un seul pays.
 */
const CODE_ALIASES: Record<string, string> = { UK: 'GB', EL: 'GR' };

/**
 * Les codes pays ISO alpha-3, tels que Workday les écrit en suffixe :
 * « Montreal, Quebec, CAN ». C'est ce format qui distingue le Canada (`CAN`)
 * de la Californie (`CA`) — sans lui, 988 offres canadiennes restaient sans
 * pays, et le risque de confusion était réel.
 */
const ALPHA3: Record<string, string> = {
  CAN: 'CA', USA: 'US', FRA: 'FR', GBR: 'GB', DEU: 'DE', ITA: 'IT', ESP: 'ES',
  JPN: 'JP', CHN: 'CN', NLD: 'NL', BEL: 'BE', CHE: 'CH', AUT: 'AT', PRT: 'PT',
  IRL: 'IE', SWE: 'SE', DNK: 'DK', NOR: 'NO', FIN: 'FI', POL: 'PL', AUS: 'AU',
  SGP: 'SG', HKG: 'HK', KOR: 'KR', IND: 'IN', MEX: 'MX', BRA: 'BR', ARE: 'AE',
  TUR: 'TR', GRC: 'GR', CZE: 'CZ', HUN: 'HU', ROU: 'RO', LUX: 'LU', MCO: 'MC',
  MAR: 'MA', ZAF: 'ZA', NZL: 'NZ', THA: 'TH', MYS: 'MY', IDN: 'ID', PHL: 'PH',
  TWN: 'TW', SAU: 'SA', QAT: 'QA', ISR: 'IL', RUS: 'RU', UKR: 'UA', VNM: 'VN',
};

function upper(raw: string): string {
  return raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
}

/**
 * Les codes de subdivision qui sont AUSSI un code pays ISO — la population à
 * risque. Pour ceux-là, la lecture « subdivision » doit être CONFIRMÉE par le
 * contexte ; les autres (`TX`, `OH`, `WA`…) ne collisionnent avec rien.
 *
 * Sans cette garde, l'audit a mesuré : « Berlin, DE » → Delaware (567 offres
 * allemandes), « Jakarta, ID » → Idaho, « Hamburg, HH, de » → Delaware.
 */
const COLLIDING_CODES = new Set([
  // Chacun est À LA FOIS un état/province et un code pays ISO 3166-1 :
  // CA Canada · IN Inde · AL Albanie · GA Gabon · KY Cayman · NC Nouvelle-Calédonie
  // SC Seychelles · SD Soudan · NE Niger · TN Tunisie · MO Macao · LA Laos
  // MT Malte · ID Indonésie · MS Montserrat · PA Panama · VA Vatican
  // DE Allemagne · ME Monténégro · AR Argentine · MD Moldavie · MA Maroc
  // NV — non attribué, mais conservé par prudence · CO Colombie · CT — · IL Israël
  // MN Mongolie · NL/ND — · OM/OK — · SK Slovaquie
  'CA', 'IN', 'AL', 'GA', 'KY', 'NC', 'SC', 'SD', 'NE', 'TN', 'MO', 'LA', 'MT',
  'ID', 'MS', 'PA', 'VA', 'DE', 'ME', 'AR', 'MD', 'MA', 'CO', 'IL', 'MN',
  // Provinces canadiennes qui sont AUSSI un code pays ISO. Leur absence a coûté
  // 474 offres d'Amsterdam (« Amsterdam, NH, nl » → Terre-Neuve-et-Labrador) :
  // NL Pays-Bas · NB — · NS — · PE Pérou · SK Slovaquie · MB — · NT — · NU Niue
  'NL', 'PE', 'SK', 'NU',
]);

/**
 * Un libellé contredit-il l'hypothèse « ce suffixe est une subdivision US » ?
 *
 * Deux signaux suffisent et sont sûrs : le libellé nomme explicitement un AUTRE
 * pays (« Hamburg, HH, de »), ou porte plus de niveaux que le format
 * « ville, état » n'en admet. On ne devine jamais depuis la ville seule — c'est
 * précisément ce qu'on refuse partout ailleurs.
 */
function contradictsUs(parts: string[]): boolean {
  // Trois segments ou plus : « Hamburg, HH, de » n'est pas « ville, état ».
  if (parts.length > 2) return true;
  // Un segment nomme un pays qui n'est pas les États-Unis.
  return parts.some((p) => {
    const named = COUNTRY_NAMES[upper(p)];
    return named !== undefined && named !== 'US';
  });
}

/**
 * Ce libellé est-il une VILLE plausible ?
 *
 * Règles GÉNÉRIQUES, jamais une liste de mauvaises villes : deux défauts réels
 * l'imposent — « /a> » (71 offres, résidu HTML) et des libellés purement
 * numériques. « Brown Thomas » (une enseigne) reste indétectable par la forme
 * seule et se traitera par cohérence avec le pays, pas par une liste noire.
 */
export function isValidCityName(raw?: string | null): boolean {
  if (!raw) return false;
  const value = raw.trim();
  if (value.length < 2) return false;
  // Résidus de balisage et entités HTML.
  if (/[<>]|&[a-z]+;|^\/|https?:\/\//i.test(value)) return false;
  // Un lieu contient au moins une lettre — « 12345 » est un code, pas une ville.
  if (!/\p{L}/u.test(value)) return false;
  return true;
}

/** Le code ISO d'un nom de pays écrit en toutes lettres, ou `undefined`. */
function countryFromName(token: string): string | undefined {
  return COUNTRY_NAMES[upper(token)];
}

/** Les tables de subdivisions dont on dispose, indexées par pays. */
const SUBDIVISIONS: Record<string, Record<string, string>> = {
  US: US_STATES,
  CA: CA_PROVINCES,
};

/** Index nom-en-toutes-lettres → forme canonique, par pays. */
const SUBDIVISION_NAMES: Record<string, Map<string, string>> = Object.fromEntries(
  Object.entries(SUBDIVISIONS).map(([country, table]) => [
    country,
    new Map(Object.values(table).map((name) => [upper(name), name])),
  ]),
);

/**
 * LA SEULE PORTE D'ENTRÉE de `adminArea1`.
 *
 * Deux invariants, tous deux imposés par une mesure en prod (2026-09-08, après
 * le premier backfill : 702 lignes fausses hors US/CA) :
 *
 *  1. **Une subdivision n'existe que sous le pays qui la possède.** « Success,
 *     WA » est en Australie (Western Australia), pas dans l'état de Washington ;
 *     « Amsterdam, NH » est en Noord-Holland, pas à Terre-Neuve. Un pays dont on
 *     n'a pas la table ne reçoit AUCUNE subdivision — mieux vaut `null` qu'une
 *     valeur incomparable (« Outlet », « Macquarie Centre »).
 *  2. **La valeur écrite est canonique.** `FL`, `Florida` et `florida` doivent
 *     produire une seule clé, sinon la colonne n'agrège pas — et agréger est sa
 *     raison d'être.
 */
function resolveSubdivision(country: string | undefined, token: string | undefined): string | undefined {
  if (!country || !token) return undefined;
  const table = SUBDIVISIONS[country];
  if (!table) return undefined;
  const trimmed = token.trim();
  return table[trimmed.toUpperCase()] ?? SUBDIVISION_NAMES[country]?.get(upper(trimmed));
}

/**
 * La géographie d'une offre, et la preuve qui l'a produite.
 *
 * L'ordre suit la fiabilité : un champ déclaré par la source bat un libellé
 * qu'il faut interpréter. Une ville seule ne produit JAMAIS de pays — « Paris »
 * existe dans 4 pays de la base.
 */
export function resolveGeography(input: GeographyInput): ResolvedGeography {
  const out: ResolvedGeography = {};

  // 1. Les champs déclarés — la preuve la plus forte.
  const rawCode = input.rawCountryCode?.trim().toUpperCase();
  if (rawCode && /^[A-Z]{2}$/.test(rawCode)) {
    out.countryCode = CODE_ALIASES[rawCode] ?? rawCode;
    out.method = 'RAW_COUNTRY_CODE';
    out.sourcePath = 'country_code';
    out.confidence = 1;
  } else if (input.rawCountry) {
    const fromName = countryFromName(input.rawCountry);
    const asCode = input.rawCountry.trim().toUpperCase();
    const code = fromName ?? (/^[A-Z]{2}$/.test(asCode) ? CODE_ALIASES[asCode] ?? asCode : undefined);
    if (code) {
      out.countryCode = code;
      out.method = 'RAW_COUNTRY';
      out.sourcePath = 'country';
      out.confidence = 1;
    }
  }

  const location = input.location?.trim();
  if (!location) {
    if (input.city && isValidCityName(input.city)) out.city = input.city.trim();
    return out;
  }

  /**
   * 2. Le préfixe `US-PA-Philadelphia` (1 237 offres) : trois niveaux d'un
   *    coup. Le pays est en tête, donc non ambigu — c'est sa position qui le
   *    qualifie, pas sa seule forme.
   */
  const prefix = location.match(/^([A-Z]{2})-([A-Z]{2})-(.+)$/);
  if (prefix) {
    const [, rawPrefix, admin, city] = prefix;
    const country = CODE_ALIASES[rawPrefix] ?? rawPrefix;
    if (!out.countryCode) {
      out.countryCode = country;
      out.method = 'LOCATION_COUNTRY_PREFIX';
      out.sourcePath = 'location';
      out.confidence = 0.95;
    }
    out.adminArea1 = resolveSubdivision(out.countryCode ?? country, admin);
    if (isValidCityName(city)) out.city = city.trim();
    return out;
  }

  const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
  const head = parts[0];
  const tail = parts[parts.length - 1];

  /**
   * 2bis. Le suffixe ISO alpha-3 : « Montreal, Quebec, CAN ». Trois lettres
   *       sont non ambiguës (aucun état US n'a de code à trois lettres), et la
   *       partie centrale porte alors la subdivision.
   */
  if (parts.length >= 3 && tail) {
    const alpha3 = ALPHA3[tail.toUpperCase()];
    if (alpha3) {
      if (!out.countryCode) {
        out.countryCode = alpha3;
        out.method = 'LOCATION_COUNTRY_NAME';
        out.sourcePath = 'location';
        out.confidence = 0.95;
      }
      const admin = parts[parts.length - 2];
      // Le segment central n'est retenu que s'il est une subdivision RECONNUE
      // du pays : « Parndorf, Outlet, AUT » écrivait « Outlet » auparavant.
      if (admin && admin !== head) out.adminArea1 = resolveSubdivision(out.countryCode, admin);
      if (isValidCityName(head)) out.city = head;
      return out;
    }
  }

  if (parts.length >= 2 && tail) {
    // 3. Le pays NOMMÉ en suffixe : « Mahé, Seychelles », « Tokyo, Japan ».
    //    Le nom complet lève l'ambiguïté que le code seul ne lèverait pas.
    const named = countryFromName(tail);
    if (named) {
      if (!out.countryCode) {
        out.countryCode = named;
        out.method = 'LOCATION_COUNTRY_NAME';
        out.sourcePath = 'location';
        out.confidence = 0.95;
      }
      if (isValidCityName(head)) out.city = head;
      return out;
    }

    /**
     * 4. La SUBDIVISION en suffixe — le cœur du piège.
     *
     * « Nashville, TN » : `TN` ne devient `US` que parce qu'il apparaît en
     * position de subdivision, après une ville. Jamais parce que « TN » est un
     * code ISO — sinon Nashville serait en Tunisie.
     */
    const asCode = tail.toUpperCase();

    /**
     * LE PAYS CONNU PRIME SUR LA TABLE. Si une preuve indépendante (champ raw,
     * ou pays déjà stocké) dit que l'offre n'est ni aux États-Unis ni au
     * Canada, alors le suffixe n'est PAS une subdivision de ces pays-là.
     *
     * Mesuré : « Success, WA » (Western Australia) devenait « Washington »,
     * « Amsterdam, NH, nl » (Noord-Holland) devenait « Terre-Neuve ». Le pays
     * était pourtant connu et correct dans les deux cas.
     */
    const known = out.countryCode ?? input.legacyCountry?.trim().toUpperCase() ?? undefined;
    if (known && known !== 'US' && known !== 'CA') {
      if (isValidCityName(head)) out.city = head;
      return out;
    }

    const stateName = US_STATES[asCode];
    const provinceName = CA_PROVINCES[asCode];
    const fullState = SUBDIVISION_NAMES.US.get(upper(tail));
    const fullProvince = SUBDIVISION_NAMES.CA.get(upper(tail));

    /**
     * La même garde de collision que pour les états, étendue aux PROVINCES.
     * Elle manquait, et c'est ce qui a coûté 474 offres d'Amsterdam : `NL`,
     * `NB`, `NS`, `PE`, `SK`, `MB`, `NT` sont tous des codes ISO pays.
     */
    if (provinceName && COLLIDING_CODES.has(asCode)) {
      const confirmsCa = known === 'CA';
      if (contradictsUs(parts) || !confirmsCa) {
        if (isValidCityName(head)) out.city = head;
        return out;
      }
    }

    /**
     * La garde de cohérence : un code qui collisionne avec un pays ne devient
     * une subdivision US que si RIEN dans le libellé ne dit le contraire. Le
     * nom complet (« Ohio ») ne collisionne avec aucun pays et passe toujours.
     */
    /**
     * LA GARDE DE COLLISION. Un code comme `DE`, `ID`, `CA` est à la fois un
     * état US et un pays. La lecture « subdivision » n'est alors qu'une
     * HYPOTHÈSE : on ne l'applique que si rien ne la contredit ET si le pays
     * déjà stocké ne dit pas autre chose.
     *
     * Mesuré : « Berlin, DE » (legacy DE = Allemagne) devenait Delaware sur
     * 567 offres, « Jakarta, ID » devenait Idaho. Le legacy avait raison.
     */
    if (stateName && COLLIDING_CODES.has(asCode)) {
      const legacy = input.legacyCountry?.trim().toUpperCase();
      /**
       * Le legacy est la seule preuve INDÉPENDANTE disponible ici :
       *  - legacy = le code lui-même (`CA` pour « El Segundo, CA ») : il
       *    n'apporte rien, c'est justement la valeur suspecte → on corrige ;
       *  - legacy = un autre pays (`DE` pour « Berlin, DE ») : il contredit
       *    l'hypothèse US → on ne touche à rien ;
       *  - pas de legacy : rien ne confirme les États-Unis, et le code peut
       *    être un pays. On s'abstient plutôt que d'inventer.
       */
      /**
       * La confirmation ne peut venir QUE d'une preuve indépendante du suffixe
       * lui-même : un champ pays dans le raw, ou un legacy déjà américain.
       *
       * Mesuré : les offres californiennes portent `country_code: US` dans leur
       * raw (112 cas), les allemandes portent `DE` (299). Sans ce signal, le
       * suffixe est indécidable — 321 offres restent alors inchangées, ce qui
       * est le comportement voulu : null ou legacy incertain vaut mieux qu'une
       * correction inventée.
       */
      // `out.countryCode` est ici la valeur issue d'un CHAMP DÉCLARÉ du raw
      // (`country_code` ou `country`), lu en étape 1 — donc une preuve
      // indépendante du suffixe qu'on cherche à interpréter.
      const confirmsUs = legacy === 'US' || out.countryCode === 'US';
      if (contradictsUs(parts) || !confirmsUs) {
        if (isValidCityName(head)) out.city = head;
        return out;
      }
    }

    if (stateName || fullState) {
      if (!out.countryCode) {
        out.countryCode = 'US';
        out.method = 'LOCATION_ADMIN1_SUFFIX';
        out.sourcePath = 'location';
        // Moins sûr qu'un champ déclaré : c'est une lecture de format.
        out.confidence = 0.9;
      }
      out.adminArea1 = stateName ?? fullState;
      if (isValidCityName(head)) out.city = head;
      return out;
    }
    if (provinceName || fullProvince) {
      if (!out.countryCode) {
        out.countryCode = 'CA';
        out.method = 'LOCATION_ADMIN1_SUFFIX';
        out.sourcePath = 'location';
        out.confidence = 0.9;
      }
      out.adminArea1 = provinceName ?? fullProvince;
      if (isValidCityName(head)) out.city = head;
      return out;
    }
  }

  /**
   * 5. Rien d'identifiable : la ville seule est conservée, le pays reste VIDE.
   *    « Paris » apparaît dans 4 pays de la base — en déduire un serait
   *    inventer une géographie.
   */
  const cityCandidate = input.city ?? head;
  if (cityCandidate && isValidCityName(cityCandidate)) out.city = cityCandidate.trim();
  return out;
}
