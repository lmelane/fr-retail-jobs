import { createHash } from 'node:crypto';

export const EXPIRY_READER_VERSION = 2;
export type ExpiryEvidence = {
  readerVersion: number; rawHash: string; path: string; value: string;
  precision: 'INSTANT' | 'DATE'; policy: 'SOURCE_INSTANT' | 'END_OF_DECLARED_DAY_ANYWHERE';
  status: 'INTERPRETED' | 'BEYOND_STORAGE_RANGE';
};
export type DeclaredExpiry = { expiresAt: Date | null; evidence: ExpiryEvidence };

/** Explicit paths qualified against stored source payloads. Never scan related/similar jobs. */
const PATHS: Readonly<Record<string, readonly string[]>> = {
  GENERIC_LISTING: ['validThrough'], GENERIC_JSONLD: ['validThrough'],
  ICIMS: ['postingEvidence.jobPosting.validThrough'],
  ALTAMIRA: ['postingEvidence.jobPosting.validThrough'],
  WORKDAY: ['detail.jobPostingInfo.endDate'],
  JIBE: ['posting_expiry_date'], PHENOM: ['posting_expiry_date'],
  TEAMTAILOR: ['_jobposting.validThrough'],
  TALENTFUNNEL: ['vacancy.validTo'], TALENT_FUNNEL: ['vacancy.validTo'],
  FLATCHR: ['vacancy.end_date'],
  ORACLEHCM: ['detail.ExternalPostedEndDate'], ORACLE_HCM: ['detail.ExternalPostedEndDate'],
  HARRI: ['detail.end_date'],
  TALENTRECRUITER: ['position.ApplicationDue'], TALENT_RECRUITER: ['position.ApplicationDue'],
  VOLCANIC: ['end_date'], SWATCHGROUP: ['jsonLd.validThrough'], SWATCH_GROUP: ['jsonLd.validThrough'],
  SUCCESSFACTORS: ['postingEvidence.jobPosting.validThrough', 'postingEvidence.microdataValidThrough'],
};

function atPath(raw: unknown, path: string): unknown {
  let value = raw;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Dates without a time zone remain calendar dates. Expire only after that day
 * has ended in every time zone; never invent the employer's time zone. */
export function parseDeclaredDeadline(value: string): { expiresAt: Date | null; precision: ExpiryEvidence['precision']; policy: ExpiryEvidence['policy']; status: ExpiryEvidence['status'] } | undefined {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (dateOnly) {
    const start = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(start.getTime()) || start.getUTCFullYear() < 1 || start.toISOString().slice(0, 10) !== value) return undefined;
    const deadline = new Date(start.getTime() + 36 * 3_600_000);
    const supported = deadline.getUTCFullYear() <= 9999;
    return { expiresAt: supported ? deadline : null, precision: 'DATE', policy: 'END_OF_DECLARED_DAY_ANYWHERE',
      status: supported ? 'INTERPRETED' : 'BEYOND_STORAGE_RANGE' };
  }
  const dotNet = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  const iso = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.exec(value);
  const httpDate = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value);
  if (!dotNet && !iso && !httpDate) return undefined;
  // JS rolls e.g. 2026-02-30 into March. Reject that malformed native date.
  if (iso) {
    const calendar = new Date(`${iso[1]}T00:00:00Z`);
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== iso[1]) return undefined;
  }
  const expiresAt = new Date(dotNet ? Number(dotNet[1]) : value);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getUTCFullYear() < 1) return undefined;
  if (httpDate && expiresAt.toUTCString() !== value) return undefined;
  const supported = expiresAt.getUTCFullYear() <= 9999;
  return { expiresAt: supported ? expiresAt : null, precision: 'INSTANT', policy: 'SOURCE_INSTANT',
    status: supported ? 'INTERPRETED' : 'BEYOND_STORAGE_RANGE' };
}

export function declaredExpiry(kind: string, raw: unknown): DeclaredExpiry | undefined {
  const paths = PATHS[kind.toUpperCase().replaceAll('-', '_')] ?? [];
  for (const path of paths) {
    const value = atPath(raw, path);
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string') return undefined;
    const parsed = parseDeclaredDeadline(value);
    if (!parsed) return undefined;
    return { expiresAt: parsed.expiresAt, evidence: { readerVersion: EXPIRY_READER_VERSION,
      rawHash: createHash('sha256').update(JSON.stringify(raw)).digest('hex'), path: `$.${path}`, value,
      precision: parsed.precision, policy: parsed.policy, status: parsed.status } };
  }
  return undefined;
}
