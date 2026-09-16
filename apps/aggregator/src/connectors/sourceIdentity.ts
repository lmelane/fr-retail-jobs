import { createHash } from 'node:crypto';
import { Prisma, type Source, type SourceIdentityReview, type PrismaClient } from '@prisma/client';
import { resolveCompany } from '../normalize/company.js';
import { lockSourceWrites } from '../lib/writeLocks.js';
import { parse } from 'tldts';

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)]));
  return value;
}

export type IdentitySource = Pick<Source, 'key' | 'maison' | 'kind' | 'config' | 'careersDomain' | 'tenantKey' | 'tier'>;

export type RevisionIdentitySource = IdentitySource & Pick<Source, 'currentRevisionId'>;
export type IdentityReviewDocument = Omit<SourceIdentityReview, 'id' | 'sequence' | 'createdAt' | 'artifactText' | 'sourceRevisionId' | 'checkedAt'> & {
  sourceRevisionId: string;
  checkedAt: Date | string;
};
type IdentityEvidence = Omit<SourceIdentityReview, 'id' | 'sequence' | 'createdAt'>;

export class SourceIdentityGateError extends Error {
  constructor(readonly code: 'REVIEW_MISSING' | 'REVISION_MISMATCH' | 'ORDER_UNKNOWN', message: string) {
    super(message); this.name = 'SourceIdentityGateError';
  }
}

/** Null historical ordinals are for inspection only; they can never certify a source. */
export const identityReviewOrder: Prisma.SourceIdentityReviewOrderByWithRelationInput[] = [
  { sequence: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' },
];

/** Read JSON text so the database driver cannot round numeric config values before hashing. */
export async function readIdentitySource(db: Prisma.TransactionClient, key: string, forUpdate = false): Promise<Source | null> {
  const rows = await db.$queryRaw<(Source & { configText: string })[]>(Prisma.sql`
    SELECT s.*, s.config::text AS "configText" FROM "Source" s WHERE s.key=${key}
    ${forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
  if (!rows[0]) return null;
  const { configText, ...source } = rows[0];
  return { ...source, config: JSON.parse(configText) };
}

/** Private reporting inventory uses the same JSON decoding as the review writer. */
export async function readIdentitySources(db: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<Source[]> {
  const rows = await db.$queryRaw<(Source & { configText: string })[]>`
    SELECT s.*, s.config::text AS "configText" FROM "Source" s ORDER BY s.key`;
  return rows.map(({ configText, ...source }) => ({ ...source, config: JSON.parse(configText) }));
}

/** Legacy source-scoped alias/candidate fingerprint. Review authority comes from SourceRevision. */
export function sourceIdentityHash(source: IdentitySource): string {
  const { key, maison, kind, config, careersDomain, tenantKey, tier } = source;
  return createHash('sha256').update(JSON.stringify(sorted({ key, maison, kind, config, careersDomain, tenantKey, tier }))).digest('hex');
}

export function sourceSubjectKey(source: Pick<Source, 'maison'>): string {
  return resolveCompany(source.maison.split('(')[0].trim()).companyId;
}

/** Validate the recorded, reviewed evidence. Never infer identity from a name score. */
export function assertIdentityReview(source: RevisionIdentitySource, review: SourceIdentityReview | null, now = new Date()): void {
  if (!review || review.verdict !== 'VERIFIED') throw new SourceIdentityGateError('REVIEW_MISSING', `promote: "${source.key}" has no verified employer identity review`);
  if (review.sequence == null) throw new SourceIdentityGateError('ORDER_UNKNOWN', 'promote: identity review has no recorded decision order');
  assertIdentityEvidence(source, review, now);
}

function assertIdentityEvidence(source: RevisionIdentitySource, review: IdentityEvidence, now: Date): void {
  if (!source.currentRevisionId || !review.sourceRevisionId || review.sourceRevisionId !== source.currentRevisionId) {
    throw new SourceIdentityGateError('REVISION_MISMATCH', 'promote: identity evidence does not match the current source revision');
  }
  if (review.sourceKey !== source.key || review.tenantKey !== source.tenantKey || review.subjectKey !== sourceSubjectKey(source) || review.sourceHash !== sourceIdentityHash(source)) {
    throw new Error(`promote: "${source.key}" identity evidence does not match the current employer/tenant/configuration`);
  }
  const age = now.getTime() - review.checkedAt.getTime();
  if (!Number.isFinite(age) || age < -300_000 || age > 30 * 86_400_000) throw new Error('promote: identity review must have been checked within 30 days');
  if (!['OFFICIAL_LINK', 'OFFICIAL_DOMAIN', 'GROUP_DOCUMENT'].includes(review.method)) throw new Error('promote: a name match or slug probe is not identity evidence');
  if (!/^[a-f0-9]{64}$/.test(review.artifactHash) || !review.reviewer.trim() || review.statement.trim().length < 30) throw new Error('promote: identity evidence needs an archived artifact, statement and reviewer');
  if (!review.artifactText || createHash('sha256').update(review.artifactText).digest('hex') !== review.artifactHash) throw new Error('promote: archived identity evidence content does not match its hash');
  const proof = new URL(review.proofUrl); const portal = new URL(review.portalUrl);
  const domain = review.officialDomain.toLowerCase();
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain) || proof.protocol !== 'https:' || portal.protocol !== 'https:' || proof.username || proof.password || portal.username || portal.password) throw new Error('promote: invalid official identity evidence URLs');
  const vendorDomains = ['jobaffinity.fr', 'candidater.fr', 'flatchr.io', 'werecruit.io', 'greenhouse.io', 'lever.co', 'smartrecruiters.com', 'teamtailor.com', 'myworkdayjobs.com', 'oraclecloud.com', 'recruitee.com', 'personio.de', 'personio.com', 'workable.com', 'welcometothejungle.com'];
  if (parse(domain).domain !== domain || vendorDomains.includes(domain)) throw new Error('promote: an ATS vendor or public suffix is not the reviewed official employer domain');
  if (proof.hostname !== domain && !proof.hostname.endsWith(`.${domain}`)) throw new Error('promote: evidence page must belong to the reviewed official domain');
}

export async function requireSourceIdentity(tx: Prisma.TransactionClient, source: Source): Promise<void> {
  // A later contradiction supersedes an earlier verification; do not select
  // only VERIFIED rows and accidentally resurrect an invalidated decision.
  const review = await tx.sourceIdentityReview.findFirst({ where: { sourceKey: source.key }, orderBy: identityReviewOrder });
  assertIdentityReview(source, review);
}

/** Records an explicit reviewer decision, never an automatically scored name. */
export async function recordSourceIdentityReview(prisma: PrismaClient, document: IdentityReviewDocument, artifact: Uint8Array, apply = false) {
  return prisma.$transaction(async tx => {
    await lockSourceWrites(tx, document.sourceKey, true);
    const source = await readIdentitySource(tx, document.sourceKey, true);
    if (!source) throw new Error('Identity review source does not exist');
    if (!artifact.length || artifact.length > 2 * 1024 * 1024) throw new Error('Identity evidence must be a nonempty UTF-8 document of at most 2 MiB');
    const artifactText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(artifact);
    const review = { ...document, artifactText, checkedAt: new Date(document.checkedAt) };
    if (!['VERIFIED', 'CONTRADICTED', 'UNRESOLVED'].includes(review.verdict)) throw new Error('Unknown identity verdict');
    // Every decision must identify the exact source and preserve its evidence.
    assertIdentityEvidence(source, review, new Date());
    if (createHash('sha256').update(artifact).digest('hex') !== review.artifactHash) throw new Error('Identity artifact hash mismatch');
    if (review.portalScope != null && !['SINGLE_BRAND', 'MULTI_BRAND'].includes(review.portalScope)) throw new Error('portalScope must be SINGLE_BRAND or MULTI_BRAND');
    const { sourceKey, sourceRevisionId, tenantKey, subjectKey, sourceHash, verdict, method, officialDomain, proofUrl, portalUrl, statement, artifactHash, reviewer, checkedAt, portalScope } = review;
    const data = { sourceKey, sourceRevisionId, tenantKey, subjectKey, sourceHash, verdict, method, officialDomain, proofUrl, portalUrl, statement, artifactHash, artifactText, reviewer, checkedAt, portalScope: portalScope ?? null };
    // An identical retried dossier must not supersede a later contradiction.
    // Dates are normalized above and fields have a fixed order here. A new
    // review requires a new explicit decision, including its reviewed date.
    const id = `identity-review:${createHash('sha256').update(JSON.stringify(data)).digest('hex')}`;
    let written = 0;
    if (apply && !await tx.sourceIdentityReview.findUnique({ where: { id }, select: { id: true } })) {
      await tx.sourceIdentityReview.create({ data: { id, ...data } });
      written = 1;
    }
    const latest = apply ? await tx.sourceIdentityReview.findFirst({ where: { sourceKey }, orderBy: identityReviewOrder, select: { id: true } }) : null;
    return { sourceKey, sourceRevisionId, sourceHash, verdict, reviewId: id, written, isLatestDecision: apply ? latest?.id === id : null };
  });
}

/** Same revision, decision order and evidence contract as promotion. Invalid evidence grants no perimeter. */
export function portalScopeOf(source: RevisionIdentitySource, review: SourceIdentityReview | null, now = new Date()): 'SINGLE_BRAND' | 'MULTI_BRAND' | null {
  try { assertIdentityReview(source, review, now); } catch { return null; }
  return review?.portalScope === 'SINGLE_BRAND' || review?.portalScope === 'MULTI_BRAND' ? review.portalScope : null;
}

export async function certifiedPortalScope(db: Pick<Prisma.TransactionClient, '$queryRaw'>, sourceKey: string, now = new Date()): Promise<'SINGLE_BRAND' | 'MULTI_BRAND' | null> {
  // One SQL statement: the registry and latest decision describe the same snapshot,
  // including when invoked inside the ingestion transaction.
  const rows = await db.$queryRaw<(Source & { configText: string; reviewText: string | null })[]>`
    SELECT s.*, s.config::text AS "configText",
      CASE WHEN r.id IS NOT NULL THEN (to_jsonb(r) || jsonb_build_object('sequence',r.sequence::text))::text END AS "reviewText"
    FROM "Source" s LEFT JOIN LATERAL (
      SELECT * FROM "SourceIdentityReview" WHERE "sourceKey"=s.key
      ORDER BY sequence DESC NULLS LAST, "createdAt" DESC, id DESC LIMIT 1
    ) r ON true WHERE s.key=${sourceKey}`;
  if (!rows[0] || !rows[0].reviewText) return null;
  const { configText, reviewText, ...source } = rows[0];
  const review = JSON.parse(reviewText);
  review.sequence = review.sequence == null ? null : BigInt(review.sequence);
  review.checkedAt = new Date(review.checkedAt);
  review.createdAt = new Date(review.createdAt);
  return portalScopeOf({ ...source, config: JSON.parse(configText) }, review, now);
}
