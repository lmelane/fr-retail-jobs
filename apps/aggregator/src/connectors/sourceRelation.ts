import type { PrismaClient } from '@prisma/client';
import { loadBuffer } from 'cheerio';
import { readSourceEvidence } from '../capture/sourceEvidence.js';
import { digestBytes } from '../capture/context.js';
import { captureReaderRevision } from '../capture/revision.js';
import { detectChallenge } from '../lib/responseIntegrity.js';
import type { ObjectStore } from '../retention/objectStore.js';
import { readIdentitySource } from './sourceIdentity.js';
import { effectiveSourceConfig } from './sourceConfig.js';
import { belongsToOfficialDomain, configuredPortal, reviewedOfficialDomain } from './sourcePortal.js';

export const SOURCE_RELATION_POLICY = 'official-html-link/1';

/** Inspect archived HTML, never text snippets or a live fallback. A matching
 * link establishes a relation to the configured board; the official domain's
 * ownership, source role and access authorization still require review. */
export async function inspectSourceRelation(db: PrismaClient, key: string, options: {
  captureBatchId: string; officialDomain: string;
}, store?: ObjectStore, now = new Date()) {
  options = Object.freeze({ ...options });
  const officialDomain = reviewedOfficialDomain(options.officialDomain);
  const source = await readIdentitySource(db, key);
  if (!source) throw new Error('Registered source required');
  const context = { policy: SOURCE_RELATION_POLICY, sourceKey: key, sourceRevisionId: source.currentRevisionId,
    captureBatchId: options.captureBatchId, officialDomain, evaluatedAt: now.toISOString(), inspectorRevision: captureReaderRevision(),
    identityApproved: false as const, coverageAttested: false as const };
  const unproven = (reason: string) => ({ ...context, verdict: 'NOT_PROVEN' as const, reason });
  const batch = await db.captureBatch.findUniqueOrThrow({ where: { id: options.captureBatchId }, include: { outcome: true } });
  if (batch.purpose !== 'SOURCE_IDENTITY') return unproven('IDENTITY_CAPTURE_REQUIRED');
  if (batch.sourceKey !== key || batch.sourceRevisionId !== source.currentRevisionId) return unproven('CAPTURE_REVISION_MISMATCH');
  if (batch.outcome?.status !== 'SOURCE_EVIDENCE') return unproven('CAPTURE_NOT_COMPLETE');
  const age = now.getTime() - batch.startedAt.getTime();
  if (age < -300_000 || age > 30 * 86_400_000) return unproven('CAPTURE_STALE');
  const portal = configuredPortal(source.kind, effectiveSourceConfig(source.config));
  if (!portal) return unproven('PORTAL_CONFIGURATION_NOT_QUALIFIED');
  // I/O failures and archive corruption remain operational errors. They must
  // not be hidden as an ordinary absence of a link.
  const evidence = await readSourceEvidence(db, batch.id, store);
  if (!belongsToOfficialDomain(evidence.initialUrl, officialDomain) ||
    !belongsToOfficialDomain(evidence.finalUrl, officialDomain) ||
    evidence.responses.some(row => !belongsToOfficialDomain(row.requestUrl, officialDomain))) return unproven('PAGE_OUTSIDE_REVIEWED_DOMAIN');
  const response = evidence.responses.at(-1)!;
  if (response.status! < 200 || response.status! >= 300) return unproven('HTTP_RESPONSE_NOT_USABLE');
  const headers = response.headers as Record<string, string>;
  const contentType = headers['content-type'] ?? '';
  if (!/^text\/html(?:\s*;|\s*$)/i.test(contentType)) return unproven('HTML_DOCUMENT_REQUIRED');
  if (detectChallenge(new Response(null, { status: response.status!, headers }), evidence.body.subarray(0, 16_000).toString('utf8'))) return unproven('CHALLENGE_DOCUMENT');
  const charset = /;\s*charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
  const $ = loadBuffer(evidence.body, { encoding: { transportLayerEncodingLabel: charset } });
  // These are inert text, not references in the active document. In particular,
  // a quoted URL in a script, comment or template cannot prove the relationship.
  $('script,style,template,noscript').remove();
  let base = evidence.finalUrl;
  const declaredBase = $('base[href]').first().attr('href');
  if (declaredBase !== undefined) { try { base = new URL(declaredBase, base).toString(); } catch { /* Invalid base uses the document URL. */ } }
  let witness: { element: string; attribute: string; ordinal: number; referenceHash: string; resolvedReferenceHash: string; queryKeys: string[] } | undefined;
  $('a[href],iframe[src]').each((ordinal, node) => {
    const element = $(node);
    if (witness || element.is('iframe[srcdoc]') || element.is('a[download]')) return;
    const attribute = node.tagName === 'a' ? 'href' : 'src';
    const reference = element.attr(attribute)!;
    let target: URL; try { target = new URL(reference, base); } catch { return; }
    if (portal.matches(target.toString())) witness = { element: node.tagName, attribute, ordinal,
      referenceHash: digestBytes(reference), resolvedReferenceHash: digestBytes(target.toString()), queryKeys: [...new Set(target.searchParams.keys())].sort() };
  });
  if (!witness) return unproven('EXACT_PORTAL_REFERENCE_NOT_FOUND');
  const current = await readIdentitySource(db, key);
  if (current?.currentRevisionId !== source.currentRevisionId) return unproven('SOURCE_CHANGED_DURING_INSPECTION');
  return { ...context, verdict: 'LINK_MATCHED' as const, reason: null, configuredPortal: portal.url,
    captureObservedAt: batch.startedAt.toISOString(), responseId: response.id, bodyHash: response.blobHash!, witness };
}
