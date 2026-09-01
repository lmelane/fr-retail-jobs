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

function collapseArrondissement(city: string): string {
  for (const base of ARRONDISSEMENT_CITIES) {
    // "PARIS 08", "PARIS 8E", "PARIS 1ER", "PARIS CEDEX 08"
    if (new RegExp(`^${base}\\b`).test(city)) return base;
  }
  return city;
}

export function normalizeLocationString(raw?: string | null): NormalizedLocation {
  const original = (raw ?? '').trim();
  if (!original) return { raw: '' };

  let value = stripAccents(original).toUpperCase().replace(/\s+/g, ' ').trim();

  // "75 - Paris" / "75008 Paris" -> capture the department, drop the digits.
  const departmentMatch = value.match(/\b(\d{2})\s*[-–]\s*[A-Z]/) ?? value.match(/\b(\d{5})\b/);
  const department = departmentMatch
    ? departmentMatch[1].slice(0, 2)
    : undefined;

  value = value
    .replace(/\bCEDEX\b.*$/, '')
    .replace(/\b\d{5}\b/g, '')
    .replace(/^\s*\d{2}\s*[-–]\s*/, '')
    .replace(/\b(FRANCE|ILE[- ]DE[- ]FRANCE|IDF)\b/g, '')
    .trim();

  // Sources join parts with commas: "Paris, Ile-de-France" -> take the first.
  const city = collapseArrondissement(
    value
      .split(',')[0]
      .replace(/\b\d+\s*(ER|EME|E)?\b/g, '')
      .replace(/[^A-Z0-9' -]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );

  return { city: city || undefined, department, raw: original };
}
