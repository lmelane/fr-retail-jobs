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
