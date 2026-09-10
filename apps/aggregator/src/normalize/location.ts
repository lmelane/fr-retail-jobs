/**
 * Location normalization — la ville canonique, telle que le candidat la voit.
 *
 * The same posting appears as "Paris", "Paris 08", "Paris 8e", "75 - Paris",
 * "Paris, Ile-de-France" or "PARIS CEDEX 08" depending on the source. Dedup keys
 * on the city, so arrondissements and department prefixes must collapse to one
 * value — while the original string is always kept for display.
 *
 * Mesuré en prod le 2026-09-06 (70 221 offres actives, 8 047 villes distinctes) :
 * ~1 900 « villes » étaient un pays, un état ou un mode de travail (« Ch » 110,
 * « Remote » 21), ~950 un libellé de magasin (« Bg 0263 Bg Womens Store »),
 * 585 un nom chinois ou coréen (上海 127), ~2 100 offres se partageaient deux ou
 * trois graphies d'une même ville (Milano 268 / Milan 181, Genève 151 / Geneva
 * 51 / Geneve 48), 202 étaient un arrondissement (« Paris-8e-Arrondissement »).
 *
 * Une seule chaîne d'analyse sert la clé de dédup (`normalizeLocationString`)
 * et la ville affichée (`displayCity`, `cityFromLocation`) : découpage en
 * segments, rejet de ce qui n'est pas une ville, exonyme (table
 * `data/reference/villes-exonymes.csv`), casse. Ce qui n'est pas une ville rend
 * `undefined` : le lieu brut reste dans `location`, mieux vaut aucune ville
 * qu'une fausse.
 */

import { countryFromLocation, normalizeCountry } from './country.js';
import { foldCityKey, isNonPlace, lookupExonym } from './cityTables.js';

export type NormalizedLocation = {
  /** Canonical city, uppercase and unaccented (e.g. "PARIS"). */
  city?: string;
  /** INSEE department code when it can be derived (e.g. "75"). */
  department?: string;
  /** The untouched source string, for display. */
  raw: string;
};

function stripAccents(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/** Paris/Lyon/Marseille arrondissements collapse to the parent city. */
const ARRONDISSEMENT_CITIES = ['PARIS', 'LYON', 'MARSEILLE'] as const;

/**
 * True for the three cities that collapse to a globally-unique parent name.
 * Their department adds nothing to a cache key — appending it only splits one
 * commune ("Paris 08" vs "75008 Paris") across two entries.
 */
export function isArrondissementCity(city?: string): boolean {
  return !!city && (ARRONDISSEMENT_CITIES as readonly string[]).includes(city);
}

function collapseArrondissement(city: string): string {
  for (const base of ARRONDISSEMENT_CITIES) {
    // "PARIS 08", "PARIS 8E", "PARIS 1ER", "PARIS CEDEX 08"
    if (new RegExp(`^${base}\\b`).test(city)) return base;
  }
  return city;
}

// ─── Nettoyage du libellé entier ─────────────────────────────────────────────

/**
 * Remote / télétravail is a working mode, not a place. Left in, it becomes a
 * parasite city ("REMOTE -", "FULL REMOTE", "TELETRAVAIL") that splits a commune
 * across the dedup key. Stripped as words, so "Remote - Paris" still keeps PARIS.
 */
const REMOTE_TOKENS_RE =
  /\b(full[- ]?remote|remote|remoto|t[ée]l[ée]travail|telework|home[- ]?office|distanciel|hybride|hybrid|on[- ]?site)\b/gi;

/** Qualifiers that only ever trail a working mode ("télétravail partiel"). */
const MODE_QUALIFIERS_RE = /\b(partiel|partielle|partial)\b/gi;

/** Emoji, drapeaux et symboles (« 🇵🇪 Peru », « Turin, 🇮🇹 Piemonte »). */
const SYMBOLS_RE = /[\p{So}\p{Cs}\p{Cn}]/gu;

/**
 * Un libellé multi-lieux (« Germany - Berlin; London, England ») ou alternatif
 * (« Poland - Remote OR Romania - Remote », « US / Canada ») : on ne lit que la
 * première alternative — la ville affichée doit être UNE ville.
 */
const ALTERNATIVES_RE = /;|\s\/\s|\s&\s|\s+or\s+|\s+ou\s+/i;

/** Séparateurs de segments : virgule, tiret entouré d'espaces, barre, point médian. */
const SEGMENTS_RE = /,|\s[-–—]\s|\s\|\s|·/;

// ─── Analyse d'un segment ────────────────────────────────────────────────────

/** Code de magasin en tête (« NM_0212_SAN FRANCISCO », « SF 0630 BOSTON », « O5_0776_WESTBURY »). */
const STORE_CODE_PREFIX_RE = /^[A-Za-z0-9]{2,3}[ _]+\d{3,5}[ _]+/;

/** Tout jeton qui contient un chiffre : code postal, arrondissement (« 8e », « 12ème »), code site (« SARI0037 », « W1B »). */
const DIGIT_TOKEN_RE = /(?<![\p{L}\p{N}])[\p{L}]*\p{N}[\p{L}\p{N}]*(?![\p{L}\p{N}])/gu;

/** Mots d'arrondissement, marqueurs postaux et caviardage (« RIYADH xxxxxx »). */
const NOISE_WORDS_RE = /\b(arrondissement|arr|cedex|[èe]me|er|x{3,})\b\.?/gi;

/** Préfixe code-pays ou province : « US-NYC », « AB-Calgary », « GB-EDH ». */
const CODE_PREFIX_RE = /^([A-Za-z]{2})-(\S.*)$/;

/**
 * Street-address lead-in. A source sometimes ships the full postal address
 * ("12 rue de la Paix 75002 Paris"); the street is never the city. When a street
 * keyword appears, only a parent city carried by the same segment survives.
 */
const STREET_WORDS_RE =
  /\b(rue|avenue|av|ave|boulevard|bd|blvd|allee|allees|impasse|place|quai|chemin|route|cours|passage|square|villa|sentier|esplanade|street|road|tower|building|floor|suite|drive|lane|highway|hwy|parkway|pkwy|strasse|str|platz|plaza|piazza|via|calle|carrer|center|centre|level|unit)\b/;

/**
 * Un magasin, un bureau, un entrepôt, un service : jamais une ville. Testé sur
 * la clé pliée (sans accents ni ponctuation) du segment.
 */
const FACILITY_WORDS_RE =
  /\b(store|stores|mall|mills|outlet\w*|retail|distribution|warehouse|entrepot|shopping|galeries|galerie|galleria|boutique|corner|pop ?up|flagship|office|offices|bureau|bureaux|hq|headquarter|headquarters|corporate|corporativo|reseau|network|networks|sede|siege|manufacture|manufacturing|factory|usine|plant|alterations|svc|ctr|womens|mens|shop|shops|concept|airport|aeroport|terminal|showroom|atelier|studio|campus|site|zone|area|metropolitan|region|regional|province|market|sales|ecommerce|e commerce|digital|logistics|logistique|support|service|services|kiosk|counter|premium|designer|fashion|department|dept|division|team|equipe|international|global)\b/;

/**
 * Un suffixe de bureau derrière un vrai nom de ville (« Berlin Head Office »,
 * « Brisbane Airport », « Kensington Office ») : la ville survit, mais un
 * segment plus net dans le même libellé lui est préféré (« Kensington Office,
 * London » → Londres ; « Hot Topic HQ - City of Industry » → City of Industry).
 */
const FACILITY_SUFFIX_RE =
  /\s+(head office|office|hq|headquarters?|airport|a[ée]roport|retail store|retail|store|boutique|bureau|corporate|metropolitan area|metro area|metro|area|county)$/i;

/** « Greater Atlanta », « Greater Manchester » : l'aire urbaine porte le nom de sa ville. */
const GREATER_PREFIX_RE = /^greater\s+/i;

/** Codes de magasin en tête de libellé (Levi's : « LFO » factory outlet, « LS » store) : le segment entier est un magasin. */
const STORE_PREFIX_RE = /^(lfo|ls fo|ls)\b/;

/** Périmètres écrits en préfixe (« APAC-C1 », « Global-NAG2 »). */
const SCOPE_PREFIX_RE = /^(apac|emea|latam|global|europe|asia|international)\b/;

/**
 * Codes à trois lettres que les sources mettent à la place d'un pays ou d'un
 * état (« Singapour, SGP », « QLD, Other », « Calgary, AB, CAN »). Une liste
 * fermée : « PAU » ou « GAP » sont des villes.
 */
const THREE_LETTER_CODES = new Set([
  'USA', 'GBR', 'DEU', 'FRA', 'ITA', 'ESP', 'NLD', 'BEL', 'CHE', 'AUT', 'PRT', 'IRL', 'CAN', 'MEX', 'BRA', 'ARG', 'CHL', 'COL',
  'PER', 'AUS', 'NZL', 'JPN', 'KOR', 'CHN', 'HKG', 'TWN', 'SGP', 'MYS', 'THA', 'VNM', 'IDN', 'PHL', 'IND', 'ARE', 'SAU', 'QAT',
  'KWT', 'ZAF', 'EGY', 'MAR', 'TUR', 'ISR', 'POL', 'CZE', 'HUN', 'ROU', 'GRC', 'SWE', 'DNK', 'NOR', 'FIN', 'RUS', 'UKR', 'LUX',
  'MCO', 'DOM', 'PRI', 'UAE', 'UK', 'QLD', 'NSW', 'VIC', 'TAS', 'ACT', 'MAN', 'EDH', 'BIR', 'CAM', 'COH',
]);

/** Codes d'état ou de province à deux lettres, tolérés en queue (« Boston FL », « Ferno VA », « Etobicoke ON »). */
const STATE_CODES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI',
  'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT',
  'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC', 'ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NT', 'WA', 'SA',
]);

/** Particules qui restent en minuscules au milieu d'un nom (Neuilly-sur-Seine, King of Prussia, Frankfurt am Main). */
const CITY_PARTICLES = new Set([
  'sur', 'sous', 'les', 'lès', 'le', 'la', 'de', 'des', 'du', 'en', 'aux', 'et', 'd', 'l', 'à',
  'am', 'an', 'der', 'im', 'bei', 'auf', 'vor', 'ob', 'of', 'on', 'upon', 'the',
  'di', 'del', 'della', 'dei', 'degli', 'delle', 'sul', 'sulla', 'y', 'i', 'da', 'do', 'das', 'dos', 'van', 'aan', 'den', 'op',
]);

/** Particules françaises qui, entre deux mots, s'écrivent toujours avec des tirets : « Aix en Provence » → Aix-en-Provence. */
const HYPHENATED_PARTICLES_RE = /(\S) (sur|sous|lès|les|en|aux) (?=\S)/gi;

type Segment = {
  /** La ville affichable, ou `undefined` quand le segment n'en porte aucune. */
  display?: string;
  /** Le segment était un pays : dans « Pays, Région, Ville » (Mango), la ville est en dernier. */
  isCountry: boolean;
  /** Ville obtenue en retirant un suffixe de bureau : un segment plus net lui est préféré. */
  weak: boolean;
};

const NONE: Segment = { isCountry: false, weak: false };

function isCountryLabel(value: string): boolean {
  return !!(normalizeCountry(value) ?? normalizeCountry(value.replace(/\s+/g, '-')));
}

/** Un jeton de fin qui n'est pas la ville : pays (« Toronto Canada »), état (« Boston FL », « Perth Western Australia »). */
function stripTrailingRegion(value: string): string {
  const tokens = value.split(' ');
  for (let width = Math.min(3, tokens.length - 1); width >= 1; width -= 1) {
    const tail = tokens.slice(-width).join(' ');
    const before = tokens[tokens.length - width - 1]?.toLowerCase() ?? '';
    // « Tremblay en France » : le pays précédé d'une particule fait partie du nom.
    if (CITY_PARTICLES.has(before)) continue;
    const upper = tail.toUpperCase();
    const isCode = width === 1 && tail.length === 2 && (STATE_CODES.has(upper) || !!normalizeCountry(upper));
    if (isCode || isCountryLabel(tail) || isNonPlace(foldCityKey(tail))) {
      return stripTrailingRegion(tokens.slice(0, -width).join(' '));
    }
  }
  return value;
}

function parentCityIn(value: string): string | undefined {
  const upper = stripAccents(value).toUpperCase();
  const parent = ARRONDISSEMENT_CITIES.find((base) => new RegExp(`\\b${base}\\b`).test(upper));
  return parent ? properCase(parent) : undefined;
}

function analyseSegment(segment: string, countryHint?: string): Segment {
  let value = segment.trim();
  if (!value) return NONE;

  const prefixed = value.match(CODE_PREFIX_RE);
  if (prefixed && (prefixed[2].length >= 4 || lookupExonym(foldCityKey(prefixed[2]), countryHint))) value = prefixed[2];

  value = value
    .replace(STORE_CODE_PREFIX_RE, '')
    .replace(/_+/g, ' ')
    .replace(DIGIT_TOKEN_RE, ' ')
    .replace(NOISE_WORDS_RE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—,.'’&]+|[\s\-–—,.&]+$/g, '')
    .trim();
  if (!value) return NONE;

  const exonym = lookupExonym(foldCityKey(value), countryHint);
  if (exonym) return { display: exonym, isCountry: false, weak: false };

  if (isCountryLabel(value)) return { isCountry: true, weak: false };
  const key = foldCityKey(value);
  // Aucun mot d'au moins deux lettres (« /a> », « D.F. », « 5 ») : rien à afficher.
  if (!/\p{L}{2}/u.test(key) || isNonPlace(key) || SCOPE_PREFIX_RE.test(key) || STORE_PREFIX_RE.test(key)) return NONE;
  if (/^[A-Za-z]{2}$/.test(value) || THREE_LETTER_CODES.has(value.toUpperCase())) return NONE;

  // Un numéro en tête (1 à 4 chiffres) suivi d'un mot de voirie : une adresse.
  // Cinq chiffres en tête sont un code postal, déjà retiré avec les jetons chiffrés.
  const leadsWithNumber = /^\d{1,4}\s/.test(segment.trim());
  const isStreet =
    STREET_WORDS_RE.test(key) || STREET_WORDS_RE.test(stripAccents(value).toLowerCase()) || (leadsWithNumber && /\bst\b/.test(key));
  if (isStreet) {
    const parent = parentCityIn(value);
    return parent ? { display: parent, isCountry: false, weak: false } : NONE;
  }

  let weak = false;
  let cleaned = value;
  if (FACILITY_SUFFIX_RE.test(cleaned) || GREATER_PREFIX_RE.test(cleaned)) {
    cleaned = cleaned.replace(FACILITY_SUFFIX_RE, '').replace(GREATER_PREFIX_RE, '');
    weak = true;
    // « DTC Office » : ce qui reste est un sigle, pas une ville.
    if (/^[A-Za-z]{1,3}$/.test(cleaned)) return NONE;
  }
  cleaned = stripTrailingRegion(cleaned);
  if (!cleaned) return NONE;
  const cleanedKey = foldCityKey(cleaned);
  const cleanedExonym = lookupExonym(cleanedKey, countryHint);
  if (cleanedExonym) return { display: cleanedExonym, isCountry: false, weak };
  if (isCountryLabel(cleaned) || isNonPlace(cleanedKey) || FACILITY_WORDS_RE.test(cleanedKey)) return NONE;
  if (/^[A-Za-z]{2}$/.test(cleaned) || THREE_LETTER_CODES.has(cleaned.toUpperCase())) return NONE;

  return { display: properCase(cleaned), isCountry: false, weak };
}

// ─── Casse d'affichage ───────────────────────────────────────────────────────

/**
 * Casse d'AFFICHAGE d'un nom de ville.
 *
 * Mesuré en prod le 2026-09-05 : « Paris » (1 860 offres) et « PARIS » (326)
 * côte à côte dans le filtre. Un nom crié ou tout en minuscules est remis en
 * casse de titre ; un nom déjà en casse mixte n'a que ses particules abaissées
 * (« King Of Prussia » → King of Prussia) et son « Mc » réparé (« Mclean » →
 * McLean) — le reste est laissé tel quel, la source sait écrire « L'Haÿ-les-Roses ».
 */
function properCase(value: string): string {
  const flat = value === value.toUpperCase() || value === value.toLowerCase();
  const cased = value
    .split(/([ \-'’])/)
    .map((part, index) => {
      if (/^[ \-'’]$/.test(part) || !part) return part;
      const lower = part.toLowerCase();
      if (index > 0 && CITY_PARTICLES.has(lower)) return lower;
      if (/^mc[a-z]/i.test(part) && part.length > 3) {
        return `Mc${part.charAt(2).toUpperCase()}${flat ? lower.slice(3) : part.slice(3)}`;
      }
      const rest = flat ? lower.slice(1) : part.slice(1);
      return part.charAt(0).toUpperCase() + rest;
    })
    .join('');
  return cased.replace(HYPHENATED_PARTICLES_RE, '$1-$2-');
}

// ─── Chaîne d'analyse partagée ───────────────────────────────────────────────

type Analysis = { display?: string; department?: string };

function analyseLocation(raw: string, hint?: string): Analysis {
  const text = raw.normalize('NFC').replace(SYMBOLS_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return {};

  // "75 - Paris" / "75008 Paris" -> capture the department, drop the digits.
  const upper = stripAccents(text).toUpperCase();
  const departmentMatch = upper.match(/\b(\d{2})\s*[-–]\s*[A-Z]/) ?? upper.match(/\b(\d{5})\b/);
  const department = departmentMatch ? departmentMatch[1].slice(0, 2) : undefined;

  const countryHint = (hint ? (normalizeCountry(hint) ?? countryFromLocation(hint)) : undefined) ?? countryFromLocation(text);

  const first = text.split(ALTERNATIVES_RE)[0] ?? '';
  const cleaned = first
    .replace(REMOTE_TOKENS_RE, ' ')
    .replace(MODE_QUALIFIERS_RE, ' ')
    .replace(/\bcedex\b.*$/i, '')
    .replace(/^\s*\d{2}\s*[-–]\s*/, '')
    .replace(/[()[\]]/g, ',');

  const segments = cleaned.split(SEGMENTS_RE).map((part) => analyseSegment(part, countryHint));
  const usable = segments.filter((segment) => segment.display);
  if (usable.length === 0) return { department };

  // « Pays, Région, Ville » (Mango, Diptyque) se lit de la fin ; sinon le premier
  // segment qui nomme une ville gagne, un segment net avant un segment affaibli.
  const ordered = segments[0]?.isCountry ? [...usable].reverse() : usable;
  const chosen = ordered.find((segment) => !segment.weak) ?? ordered[0];
  return { display: chosen.display, department };
}

/** La clé de dédup d'une ville affichable : majuscules sans accents ; un nom non latin reste lui-même. */
function cityKey(display: string): string {
  const ascii = stripAccents(display).toUpperCase().replace(/[^A-Z0-9' -]+/g, ' ').replace(/\s+/g, ' ').trim();
  return ascii ? collapseArrondissement(ascii) : display.toUpperCase();
}

export function normalizeLocationString(raw?: string | null): NormalizedLocation {
  const original = (raw ?? '').trim();
  if (!original) return { raw: '' };
  const { display, department } = analyseLocation(original);
  return { city: display ? cityKey(display) : undefined, department, raw: original };
}

/**
 * La ville canonique affichable d'un libellé — ville seule ou lieu complet.
 *
 * `hint` est un pays (ISO-2) ou un libellé de lieu qui en porte un : il
 * n'intervient que pour les exonymes ambigus (« Venice » n'est Venise que sous
 * IT — Venice, CA et Venice, FL existent et recrutent).
 */
export function displayCity(raw?: string | null, hint?: string | null): string | undefined {
  const text = (raw ?? '').trim();
  if (!text) return undefined;
  const { display } = analyseLocation(text, hint ?? undefined);
  return display && display.length >= 2 ? display : undefined;
}

/**
 * La ville portée par un libellé de lieu libre, quand la source ne fournit pas
 * de champ dédié. Même chaîne que `displayCity` : une adresse de rue est sautée
 * (« 1 World Trade Center, New York, NY » → New York), un mode de travail ou un
 * pays ne font pas une ville. Mieux vaut aucune ville qu'une fausse.
 */
export function cityFromLocation(raw?: string | null): string | undefined {
  return displayCity(raw);
}
