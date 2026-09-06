import { createHash } from 'node:crypto';

export function collapseWhitespace(value: string): string {
  return value.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
}

export function canonicalCompanyKey(value: string): string {
  return collapseWhitespace(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\b(SAS|SASU|SA|SARL|S\.A\.S\.?|FRANCE)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A salary amount, coerced to a positive number or undefined.
 *
 * The salary columns are Int?, but a schema.org feed hands the amount over as a
 * string ("75000", sometimes "€75,000"). Passed through unchanged it crashed
 * job.create and the offer was lost. This runs at the ingest boundary for every
 * source, so no adapter can leak a non-number into the write. A comma is a
 * thousands separator here (75,000 = 75000), not a decimal.
 */
export function coerceAmount(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[^0-9.]/g, '');
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * An error message collapsed to a single bounded line.
 *
 * A Prisma error message is the ENTIRE failed invocation — the whole job.create
 * payload, description included, ~90 lines. Logged per write failure it flooded
 * the Railway log stream past its 500-lines/second cap, and 2 600+ lines were
 * dropped — including OTHER errors we then never saw. The reason (e.g. "Unique
 * constraint failed on…") sits at the end of that dump, so this keeps the first
 * line AND any constraint/failure line, on ONE line, capped.
 */
export function briefError(error: unknown, maxLength = 200): string {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  const lines = message.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return message.slice(0, maxLength);
  // The reason sits AFTER the first line in a Prisma dump, so search the rest.
  // A dumped payload line is `key: value,` — never the real error — and matched
  // "required" in a field name like `is_required`, hiding the true message
  // ("Argument salaryCurrency: … Expected String, provided Int"). So skip
  // payload lines, and prefer Prisma's own error phrasing.
  const rest = lines.slice(1).filter((line) => !/^[\w$]+:\s.*,?$/.test(line));
  const reason =
    rest.find((line) => /^(Argument|Unique constraint|Foreign key|Null constraint)\b|Invalid value|Expected .* provided/i.test(line)) ??
    rest.find((line) => /constraint|failed|invalid|missing|required|violat|duplicate/i.test(line));
  const summary = reason ? `${lines[0]} — ${reason}` : lines[0];
  return summary.length > maxLength ? `${summary.slice(0, maxLength - 1)}…` : summary;
}

/**
 * A value coerced to a non-empty string, or undefined.
 *
 * A String? column (salaryCurrency, salaryPeriod) must never receive the number
 * an adapter sometimes sends — TalentView's numeric currency id crashed every
 * write. A string passes through, a number becomes its text, everything else is
 * dropped.
 */
/**
 * Une coordonnée GPS, quel que soit le type que l'adaptateur a laissé passer.
 *
 * Mesuré en prod le 2026-09-06 : Rituals sert `lonLat.lat` en chaîne
 * ("52.37"), écrite telle quelle dans une colonne Float → 577 offres sur
 * 1 088 refusées à l'écriture (« Expected Float or Null, provided String »).
 * Coercé ICI, à la frontière, pour qu'aucun adaptateur ne puisse plus faire
 * fuir ce type. Hors plage (|lat| > 90, |lng| > 180) = pas une coordonnée.
 */
export function coerceCoordinate(value: unknown, max = 180): number | undefined {
  // Number('') vaut 0 : une chaîne vide n'est pas une coordonnée à l'équateur.
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim()) : NaN;
  return Number.isFinite(parsed) && Math.abs(parsed) <= max ? parsed : undefined;
}

export function coerceText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function slugFromFashionJobsUrl(url: string): string | undefined {
  const match = new URL(url).pathname.match(/\/recrutement\/([^/]+)\.html/i);
  return match?.[1];
}

export function jobFingerprint(input: {
  company: string;
  title: string;
  location?: string;
}): string {
  const raw = [canonicalCompanyKey(input.company), normalizeJobTitle(input.title), normalizeLocation(input.location ?? '')].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

export function normalizeJobTitle(value: string): string {
  return collapseWhitespace(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\b(H\/F|F\/H|H-F|F-H|M\/F|F\/M|HFX|F\/?H\/?X)\b/g, ' ')
    .replace(/[^A-Z0-9+#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeLocation(value: string): string {
  return collapseWhitespace(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/**
 * Un titre tel qu'on l'affiche : entités décodées, balises retirées, espaces
 * repliés. 129 titres portaient encore des entités et 2 300 des espaces
 * parasites parce que le titre n'était jamais nettoyé (audit A1, 2026-09-06).
 */
export function cleanTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;(amp|lt|gt|nbsp|quot|#\d+);/gi, '&$1;')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&(?:quot|rsquo|lsquo|apos);/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

/** Un lieu ou une ville : jamais un fragment de balise (« /a> », 71 offres L'Oréal, audit A1). */
export function cleanPlace(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || /[<>]/.test(text) || /\bvar\s|function\s*\(/.test(text)) return undefined;
  return text;
}

/** Une date de publication plausible : ni demain, ni invalide (5 offres « publiées en 2028 », audit A1). */
export function plausiblePostedAt(value: unknown, now = new Date()): Date | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  return value.getTime() > now.getTime() + 86_400_000 ? undefined : value;
}

const PERIODS: Record<string, string> = {
  year: 'YEAR', yearly: 'YEAR', annual: 'YEAR', annually: 'YEAR', an: 'YEAR', annee: 'YEAR', année: 'YEAR', per_year: 'YEAR',
  month: 'MONTH', monthly: 'MONTH', mois: 'MONTH', per_month: 'MONTH',
  week: 'WEEK', weekly: 'WEEK', semaine: 'WEEK',
  day: 'DAY', daily: 'DAY', jour: 'DAY',
  hour: 'HOUR', hourly: 'HOUR', heure: 'HOUR', per_hour: 'HOUR',
};
/** Période de salaire canonique (YEAR | MONTH | WEEK | DAY | HOUR), sinon rien. */
export function canonicalPeriod(value: unknown): string | undefined {
  const key = coerceText(value)?.toLowerCase().replace(/[\s-]+/g, '_');
  if (!key) return undefined;
  if (['YEAR', 'MONTH', 'WEEK', 'DAY', 'HOUR'].includes(key.toUpperCase())) return key.toUpperCase();
  return PERIODS[key];
}

const REMOTE: Array<[RegExp, string]> = [
  [/^(no|non|none|onsite|on[-_ ]?site|sur[-_ ]?site|office|presentiel|présentiel|false)$/i, 'no'],
  [/^(partial|hybrid|hybride|partiel|télétravail partiel|teletravail partiel|part)$/i, 'partial'],
  [/^(yes|oui|full|fulltime|full[-_ ]?remote|remote|télétravail|teletravail|true|total)$/i, 'full'],
];
/** Télétravail canonique (no | partial | full), sinon rien — « unknown » et les libellés bruts ne sont plus stockés. */
export function canonicalRemote(value: unknown): string | undefined {
  const text = coerceText(value);
  if (!text) return undefined;
  for (const [re, out] of REMOTE) if (re.test(text.trim())) return out;
  return undefined;
}

const MAJOR = new Set(['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD']);
const MAX_MAJOR_ANNUAL = 1_000_000;
/** Un salaire en devise majeure au-delà d'un million par an est une erreur de source (Michael Page : 58–66 M€), pas un salaire. */
export function boundedSalary(min: number | undefined, max: number | undefined, currency: unknown): { salaryMin: number | undefined; salaryMax: number | undefined } {
  const cur = coerceText(currency)?.toUpperCase();
  const aberrant = (cur === undefined || MAJOR.has(cur)) && ((min ?? 0) > MAX_MAJOR_ANNUAL || (max ?? 0) > MAX_MAJOR_ANNUAL);
  return aberrant ? { salaryMin: undefined, salaryMax: undefined } : { salaryMin: min, salaryMax: max };
}
