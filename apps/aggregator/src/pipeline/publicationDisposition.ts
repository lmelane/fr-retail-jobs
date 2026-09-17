import type { DeactivationDisposition } from './lifecycle.js';

/** Explicit publisher observations, distinct from parsing/network failures. */
const dispositions: Readonly<Record<string, DeactivationDisposition>> = {
  APPLICATION_HTTP_404: { kind: 'CLOSED' },
  APPLICATION_HTTP_410: { kind: 'CLOSED' },
  APPLICATION_EXPLICITLY_CLOSED: { kind: 'CLOSED' },
  SOURCE_UNLISTED: { kind: 'WITHDRAWN', reason: 'SOURCE_UNLISTED' },
  /** A reviewed PostingScopeDecision OUT_OF_SCOPE: published no more, never an employer closure, never re-opened by attestation. */
  SCOPE_OUT_OF_PERIMETER: { kind: 'WITHDRAWN', reason: 'OUT_OF_SCOPE' },
};
export function publicationDisposition(reason: string): DeactivationDisposition | undefined {
  return Object.hasOwn(dispositions, reason) ? dispositions[reason] : undefined;
}

/** Only explicit native evidence can lift a publisher's earlier unlisting. */
export function explicitlyListed(kind: string | undefined, raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  if (kind === 'ASHBY') return value.isListed === true;
  if (kind !== 'HARRI' || !value.detail || typeof value.detail !== 'object' || Array.isArray(value.detail)) return false;
  const detail = value.detail as Record<string, unknown>;
  return detail.status === 'PUBLISHED' && detail.access_mode !== 'PRIVATE' && detail.post_type !== 'PRIVATE' && detail.deleted !== true;
}
