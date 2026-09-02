/**
 * Location normalization.
 *
 * The same posting appears as "Paris", "Paris 08", "Paris 8e", "75 - Paris",
 * "Paris, Ile-de-France" or "PARIS CEDEX 08" depending on the source. Dedup keys
 * on the city, so arrondissements and department prefixes must collapse to one
 * value — while the original string is always kept for display.
 */

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

/**
 * Remote / télétravail is a working mode, not a place. Left in, it becomes a
 * parasite city ("REMOTE -", "FULL REMOTE", "TELETRAVAIL") that splits a commune
 * across the dedup key. Stripped as words, so "Remote - Paris" still keeps PARIS.
 */
const REMOTE_TOKENS_RE =
  /\b(FULL[- ]?REMOTE|REMOTE|TELETRAVAIL|TELEWORK|HOME[- ]?OFFICE|100\s*%?\s*TELETRAVAIL|DISTANCIEL|HYBRIDE|HYBRID)\b/g;

/** Qualifiers that only ever trail a working mode ("télétravail partiel"). */
const MODE_QUALIFIERS_RE = /\b(PARTIEL|PARTIELLE|PARTIAL)\b/g;

/**
 * Street-address lead-in. A source sometimes ships the full postal address
 * ("12 rue de la Paix 75002 Paris"); the street is never the city. When a street
 * keyword appears, everything from it up to the trailing town is dropped.
 */
const STREET_TYPES_RE =
  /\b(RUE|AVENUE|\bAV\b|BOULEVARD|\bBD\b|ALLEE|ALLEES|IMPASSE|PLACE|QUAI|CHEMIN|ROUTE|COURS|PASSAGE|SQUARE|VILLA|SENTIER|ESPLANADE)\b/;

/**
 * A comma segment that is only an arrondissement ("1ER ARRONDISSEMENT",
 * "2E ARR.", "ARRONDISSEMENT") carries no city and must be skipped.
 */
const ARRONDISSEMENT_ONLY_RE = /^\s*\d*\s*(ER|EME|E)?\s*(ARRONDISSEMENT|ARR\.?)\s*$/;

/** Arrondissement markers, removed wherever they trail a city name. */
const ARRONDISSEMENT_WORD_RE = /\b(ARRONDISSEMENT|ARR\.?)\b/g;

function cleanSegment(segment: string): string {
  // A street segment names no city on its own. Keep a parent city if the address
  // carries one ("Place Vendôme 75001 Paris" -> PARIS); otherwise drop the whole
  // segment so a later one ("…, 13100 Aix") can supply the town.
  let value = segment;
  if (STREET_TYPES_RE.test(value)) {
    const parent = ARRONDISSEMENT_CITIES.find((base) => new RegExp(`\\b${base}\\b`).test(value));
    value = parent ?? '';
  }

  return value
    .replace(/\b\d+\s*(ER|EME|E)?\b/g, ' ')
    .replace(ARRONDISSEMENT_WORD_RE, ' ')
    .replace(/[^A-Z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    // A separator left dangling once a token was stripped ("- PARIS", "PARIS -").
    .replace(/^[\s'-]+|[\s'-]+$/g, '')
    .trim();
}

export function normalizeLocationString(raw?: string | null): NormalizedLocation {
  const original = (raw ?? '').trim();
  if (!original) return { raw: '' };

  let value = stripAccents(original).toUpperCase().replace(/\s+/g, ' ').trim();

  // "75 - Paris" / "75008 Paris" -> capture the department, drop the digits.
  const departmentMatch = value.match(/\b(\d{2})\s*[-–]\s*[A-Z]/) ?? value.match(/\b(\d{5})\b/);
  const department = departmentMatch ? departmentMatch[1].slice(0, 2) : undefined;

  value = value
    .replace(REMOTE_TOKENS_RE, ' ')
    .replace(MODE_QUALIFIERS_RE, ' ')
    .replace(/\bCEDEX\b.*$/, '')
    .replace(/\b\d{5}\b/g, '')
    .replace(/^\s*\d{2}\s*[-–]\s*/, '')
    .replace(/\b(FRANCE|ILE[- ]DE[- ]FRANCE|IDF)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Sources join parts with commas. Clean each segment, then take the first that
  // still names a place: a street-only or arrondissement-only lead
  // ("Cours Mirabeau, 13100 Aix", "1er arrondissement, Paris") is skipped for the
  // segment that carries the real city.
  const segments = value.split(',').map((part) => part.trim());
  const cities = segments
    .filter((part) => part && !ARRONDISSEMENT_ONLY_RE.test(part))
    .map((part) => collapseArrondissement(cleanSegment(part)));
  const city = cities.find(Boolean) ?? '';

  return { city: city || undefined, department, raw: original };
}
