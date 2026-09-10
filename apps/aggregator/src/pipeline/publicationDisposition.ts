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
