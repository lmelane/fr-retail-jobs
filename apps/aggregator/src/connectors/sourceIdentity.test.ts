import { expect, it } from 'vitest';
import type { Prisma, SourceIdentityReview } from '@prisma/client';
import { assertIdentityReview, portalScopeOf, sourceIdentityHash, sourceSubjectKey } from './sourceIdentity.js';
import { SOURCE_RELATION_POLICY } from './sourceRelation.js';

const at = new Date('2026-09-08T12:00:00Z');
const source = { currentRevisionId: 'revision-a', key: 'group-test', maison: 'Synthetic Group (all brands)', kind: 'ashby', config: { board: 'group-test' }, careersDomain: 'group.example', tier: 'GROUP_OFFICIAL', tenantKey: 'ashby:group-test' };
const review = (): SourceIdentityReview => ({
  id: 'review', sourceRevisionId: source.currentRevisionId, sequence: 1n, sourceKey: source.key, tenantKey: source.tenantKey, subjectKey: sourceSubjectKey(source), sourceHash: sourceIdentityHash(source),
  verdict: 'VERIFIED', portalScope: null, method: 'OFFICIAL_LINK', officialDomain: 'group.example', proofUrl: 'https://group.example/careers',
  portalUrl: 'https://jobs.ashbyhq.com/group-test', statement: 'Synthetic official group page links to the explicitly reviewed native portal.', artifactHash: 'a'.repeat(64), artifactText: '', reviewer: 'test', checkedAt: at, createdAt: at,
  evidenceCaptureBatchId: 'capture', relationReport: { archiveVerified: true, policy: SOURCE_RELATION_POLICY, sourceKey: source.key, sourceRevisionId: source.currentRevisionId,
    captureBatchId: 'capture', officialDomain: 'group.example', evaluatedAt: at.toISOString(), inspectorRevision: 'test-reader',
    identityApproved: false, coverageAttested: false, verdict: 'LINK_MATCHED', proofUrl: 'https://group.example/careers',
    configuredPortal: 'https://jobs.ashbyhq.com/group-test', captureObservedAt: at.toISOString(), responseId: 'response', bodyHash: 'a'.repeat(64),
    witness: { element: 'a', attribute: 'href', ordinal: 1, referenceHash: 'b'.repeat(64), resolvedReferenceHash: 'c'.repeat(64), queryKeys: [] } },
});

it('accepts an archived group portal without requiring a separate domain for each brand', () => {
  expect(() => assertIdentityReview(source, review(), at)).not.toThrow();
});
it('does not transfer a review to a different tenant or employer', () => {
  expect(() => assertIdentityReview({ ...source, config: { board: 'Other' } }, review(), at)).toThrow(/configuration/);
  expect(() => assertIdentityReview({ ...source, maison: 'Other' }, review(), at)).toThrow(/configuration/);
});
it('keeps missing, contradicted, expired and name-only evidence out', () => {
  expect(() => assertIdentityReview(source, null, at)).toThrow(/identity/);
  expect(() => assertIdentityReview(source, { ...review(), verdict: 'CONTRADICTED' }, at)).toThrow(/identity/);
  expect(() => assertIdentityReview(source, { ...review(), method: 'NAME_MATCH' }, at)).toThrow(/name match/);
  expect(() => assertIdentityReview(source, { ...review(), checkedAt: new Date('2026-01-01') }, at)).toThrow(/30 days/);
});
it('does not certify historical text, even with a valid revision and order', () => {
  const historical = { ...review(), evidenceCaptureBatchId: null, relationReport: null, artifactText: 'Historical evidence' };
  expect(() => assertIdentityReview(source, historical, at)).toThrow(/archived/);
});
it.each([
  { policy: 'obsolete-policy' }, { captureBatchId: 'other' }, { sourceRevisionId: 'other' }, { bodyHash: 'd'.repeat(64) },
  { configuredPortal: 'https://jobs.ashbyhq.com/other' }, { officialDomain: 'other.example' }, { verdict: 'NOT_PROVEN' },
  { captureObservedAt: new Date(at.getTime() - 31 * 86400000).toISOString() }, { witness: { element: 'a', attribute: 'href' } },
])('refuses broken native proof projection %j', change => {
  const row = review(); row.relationReport = { ...(row.relationReport as Prisma.JsonObject), ...change };
  expect(() => assertIdentityReview(source, row, at)).toThrow(/archived/);
  expect(portalScopeOf(source, { ...row, portalScope: 'SINGLE_BRAND' }, at)).toBeNull();
});
it('requires the reviewed official domain and exact configured board even for a self-consistent projection', () => {
  const row = review(); row.proofUrl = 'https://group.example.evil.example/careers';
  row.relationReport = { ...(row.relationReport as Prisma.JsonObject), proofUrl: row.proofUrl };
  expect(() => assertIdentityReview(source, row, at)).toThrow(/official domain/);
  row.proofUrl = 'https://group.example/careers'; row.portalUrl = 'https://jobs.ashbyhq.com/other';
  row.relationReport = { ...(row.relationReport as Prisma.JsonObject), proofUrl: row.proofUrl, configuredPortal: row.portalUrl };
  expect(() => assertIdentityReview(source, row, at)).toThrow(/exact native portal/);
});
it('uses the same strict contract for promotion and the optional reviewed perimeter', () => {
  expect(portalScopeOf(source, { ...review(), portalScope: 'SINGLE_BRAND' }, at)).toBe('SINGLE_BRAND');
  expect(portalScopeOf(source, { ...review(), portalScope: 'MULTI_BRAND' }, at)).toBe('MULTI_BRAND');
  expect(portalScopeOf(source, review(), at)).toBeNull();
  expect(portalScopeOf(source, { ...review(), portalScope: 'SINGLE_BRAND', checkedAt: new Date('2026-01-01') }, at)).toBeNull();
  expect(portalScopeOf(source, null, at)).toBeNull();
});
it('refuses unbound historical evidence and a return to the same configuration under a new revision', () => {
  expect(() => assertIdentityReview(source, { ...review(), sourceRevisionId: null }, at)).toThrowError(expect.objectContaining({ code: 'REVISION_MISMATCH' }));
  expect(() => assertIdentityReview(source, { ...review(), sequence: null }, at)).toThrowError(expect.objectContaining({ code: 'ORDER_UNKNOWN' }));
  const returned = { ...source, currentRevisionId: 'revision-a-returned' };
  expect(sourceIdentityHash(returned)).toBe(sourceIdentityHash(source));
  expect(() => assertIdentityReview(returned, review(), at)).toThrowError(expect.objectContaining({ code: 'REVISION_MISMATCH' }));
  expect(portalScopeOf(returned, { ...review(), portalScope: 'SINGLE_BRAND' }, at)).toBeNull();
});
