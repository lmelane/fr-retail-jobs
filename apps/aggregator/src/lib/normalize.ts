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
