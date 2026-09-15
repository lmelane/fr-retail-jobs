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
