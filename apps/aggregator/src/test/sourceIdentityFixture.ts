import type { PrismaClient, Source } from '@prisma/client';
import { vi } from 'vitest';
import { configuredPortal } from '../connectors/sourcePortal.js';
import { effectiveSourceConfig } from '../connectors/sourceConfig.js';
import { captureSourceEvidence } from '../capture/sourceEvidence.js';
import type { IdentityReviewDocument } from '../connectors/sourceIdentity.js';

/** Synthetic native transport only; persistence, archive and parser remain real. */
export async function captureIdentityFixture(db: PrismaClient, source: Source, options: { body?: string; status?: number } = {}): Promise<IdentityReviewDocument> {
  const portal = configuredPortal(source.kind, effectiveSourceConfig(source.config));
  if (!portal) throw new Error('Qualified synthetic portal configuration required');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(options.body ?? `<a href="${portal.url}">Careers</a>`,
    { status: options.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8' } })));
  const receipt = await captureSourceEvidence(db, source.key, { revisionId: source.currentRevisionId, purpose: 'SOURCE_IDENTITY',
    url: 'https://identity-witness.example/careers', deadlineMs: 15000 });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Identity recording must not fetch a portal'); }));
  return { sourceKey: source.key, sourceRevisionId: source.currentRevisionId, captureBatchId: receipt.captureBatchId,
    verdict: 'VERIFIED', officialDomain: 'identity-witness.example', statement: 'Synthetic fixture: the archived employer page links this exact native board.',
    reviewer: 'integration-test', checkedAt: new Date().toISOString(), portalScope: 'SINGLE_BRAND' };
}
