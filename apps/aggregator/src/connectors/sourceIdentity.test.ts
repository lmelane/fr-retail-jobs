import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { SourceIdentityReview } from '@prisma/client';
import { assertIdentityReview, sourceIdentityHash, sourceSubjectKey } from './sourceIdentity.js';

const at = new Date('2026-09-08T12:00:00Z');
const artifactText = 'SMCP careers: https://jobs.smartrecruiters.com/SMCP';
const source = { key: 'sandro', maison: 'SMCP (toutes Maisons)', kind: 'smartrecruiters-whitelabel', config: { company: 'SMCP', employerField: 'Brands' }, careersDomain: 'smcp.com', tier: 'GROUP_OFFICIAL', tenantKey: 'smartrecruiters-whitelabel:smcp' };
const review = (): SourceIdentityReview => ({
  id: 'review', sourceKey: source.key, tenantKey: source.tenantKey, subjectKey: sourceSubjectKey(source), sourceHash: sourceIdentityHash(source),
  verdict: 'VERIFIED', portalScope: null, method: 'GROUP_DOCUMENT', officialDomain: 'smcp.com', proofUrl: 'https://www.smcp.com/fr/talents/offres-d-emploi/',
  portalUrl: 'https://jobs.smartrecruiters.com/SMCP', statement: 'The official SMCP group publishes this career portal for its named brands.', artifactHash: createHash('sha256').update(artifactText).digest('hex'), artifactText, reviewer: 'test', checkedAt: at, createdAt: at,
});

it('accepts a group proof without requiring each brand to have a separate domain', () => {
  expect(() => assertIdentityReview(source, review(), at)).not.toThrow();
});
it('does not transfer a review to a different tenant or employer', () => {
  expect(() => assertIdentityReview({ ...source, config: { company: 'Other' } }, review(), at)).toThrow(/configuration/);
  expect(() => assertIdentityReview({ ...source, maison: 'Sandro' }, review(), at)).toThrow(/configuration/);
});
it('keeps missing, contradicted, expired and name-only evidence out', () => {
  expect(() => assertIdentityReview(source, null, at)).toThrow(/identity/);
  expect(() => assertIdentityReview(source, { ...review(), verdict: 'CONTRADICTED' }, at)).toThrow(/identity/);
  expect(() => assertIdentityReview(source, { ...review(), method: 'NAME_MATCH' }, at)).toThrow(/name match/);
  expect(() => assertIdentityReview(source, { ...review(), checkedAt: new Date('2026-01-01') }, at)).toThrow(/30 days/);
});
it('requires evidence on the reviewed official domain and an archived artifact', () => {
  expect(() => assertIdentityReview(source, { ...review(), proofUrl: 'https://smcp.com.example.com/' }, at)).toThrow(/official domain/);
  expect(() => assertIdentityReview(source, { ...review(), artifactHash: '' }, at)).toThrow(/archived artifact/);
});
