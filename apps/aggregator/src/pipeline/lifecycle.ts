/** A catalogue decision cannot establish an employer closure. All writers use
 * these transitions so source retirement and a fresh attestation agree. */
export type WithdrawalReason = 'SOURCE_RETIRED' | 'SOURCE_UNLISTED' | 'IDENTITY_CONTRADICTED' | 'OUT_OF_SCOPE' | 'ATTESTATION_MISSING';
export type DeactivationDisposition = { kind: 'CLOSED' } | { kind: 'WITHDRAWN'; reason: WithdrawalReason };
type State = { isActive: boolean; closedAt: Date | null; withdrawnAt: Date | null };

export function deactivateJob(state: State, disposition: DeactivationDisposition, at: Date) {
  // Keep earlier employer closure/withdrawal evidence intact on a no-op.
  if (!state.isActive) return null;
  return disposition.kind === 'CLOSED'
    ? { type: 'CLOSED' as const, data: { isActive: false, closedAt: at, withdrawnAt: null, withdrawalReason: null } }
    : { type: 'WITHDRAWN' as const, data: { isActive: false, closedAt: null, withdrawnAt: at, withdrawalReason: disposition.reason } };
}

export function reactivateJob(state: State) {
  if (state.isActive) return null;
  const reopened = state.closedAt !== null;
  return { type: reopened ? 'REOPENED' as const : 'REPUBLISHED' as const,
    data: { isActive: true, closedAt: null, withdrawnAt: null, withdrawalReason: null,
      ...(reopened ? { reopenedCount: { increment: 1 } } : {}) } };
}
