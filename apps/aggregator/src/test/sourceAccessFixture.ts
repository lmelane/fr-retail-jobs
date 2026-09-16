import type { PrismaClient, Source } from '@prisma/client';
import { vi } from 'vitest';
import { readRequestData } from '../capture/requestDataRead.js';
import { captureSourceEvidence } from '../capture/sourceEvidence.js';
import { recordSourceAccessDecision } from '../connectors/sourceAccess.js';
import type { AccessDocument, AccessScope } from '../connectors/accessScope.js';
import { evidenceHash } from '../lib/evidenceHash.js';

/** Synthetic robots transport only. Scope derivation, immutable receipts,
 * inspection, review ordering and database guards are the production path. */
export async function accessFixture(db: PrismaClient, source: Source, captureBatchId: string,
  options: { apply?: boolean; robots?: string; scopes?: AccessScope[] } = {}) {
  const unique = new Map<string, AccessScope>();
  for (const row of await db.rawCapture.findMany({ where: { batchId: captureBatchId } })) {
    const data = await readRequestData(db, row);
    for (const hop of data?.hops ?? []) {
      const url = new URL(hop.request.url);
      const scope: AccessScope = { origin: url.origin, path: { kind: 'EXACT', value: url.pathname }, methods: [hop.request.method as 'GET'],
        query: { fixed: Object.fromEntries(url.searchParams), variable: [] }, surface: 'PUBLIC_ATS_JOB_API' };
      unique.set(evidenceHash(scope), scope);
    }
  }
  const scopes = options.scopes ?? [...unique.values()];
  const robotsCaptureIds: string[] = [];
  const previous = globalThis.fetch;
  try {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(options.robots ?? 'User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } })));
    for (const origin of new Set(scopes.map(scope => scope.origin))) {
      const proof = await captureSourceEvidence(db, source.key, { revisionId: source.currentRevisionId, purpose: 'SOURCE_ACCESS',
        url: origin + '/robots.txt', deadlineMs: 15000 });
      robotsCaptureIds.push(proof.captureBatchId);
    }
  } finally { vi.stubGlobal('fetch', previous); }
  const document: AccessDocument = { sourceKey: source.key, sourceRevisionId: source.currentRevisionId, captureBatchId,
    verdict: 'ALLOWED', scopes, robotsCaptureIds, statement: 'Synthetic test only: these public job endpoints exercise the existing owner scope.',
    reviewer: 'integration-test', checkedAt: new Date().toISOString() };
  const result = await recordSourceAccessDecision(db, document, options.apply !== false);
  return { document, result };
}
