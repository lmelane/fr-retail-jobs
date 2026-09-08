import { createHash } from 'node:crypto';
import type { Source, SourceIdentityReview, Prisma, PrismaClient } from '@prisma/client';
import { resolveCompany } from '../normalize/company.js';
import { lockSourceWrites } from '../lib/writeLocks.js';
import { parse } from 'tldts';

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)]));
  return value;
}

export type IdentitySource = Pick<Source, 'key' | 'maison' | 'kind' | 'config' | 'careersDomain' | 'tenantKey' | 'tier'>;

/** A review cannot silently transfer to another employer, tenant or config. */
export function sourceIdentityHash(source: IdentitySource): string {
  const { key, maison, kind, config, careersDomain, tenantKey, tier } = source;
  return createHash('sha256').update(JSON.stringify(sorted({ key, maison, kind, config, careersDomain, tenantKey, tier }))).digest('hex');
}

export function sourceSubjectKey(source: Pick<Source, 'maison'>): string {
  return resolveCompany(source.maison.split('(')[0].trim()).companyId;
}

/** Validate the recorded, reviewed evidence. Never infer identity from a name score. */
export function assertIdentityReview(source: IdentitySource, review: SourceIdentityReview | null, now = new Date()): void {
  if (!review || review.verdict !== 'VERIFIED') throw new Error(`promote: "${source.key}" has no verified employer identity review`);
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
  const vendorDomains = ['greenhouse.io', 'lever.co', 'smartrecruiters.com', 'teamtailor.com', 'myworkdayjobs.com', 'oraclecloud.com', 'recruitee.com', 'personio.de', 'personio.com', 'workable.com', 'welcometothejungle.com'];
  if (parse(domain).domain !== domain || vendorDomains.includes(domain)) throw new Error('promote: an ATS vendor or public suffix is not the reviewed official employer domain');
  if (proof.hostname !== domain && !proof.hostname.endsWith(`.${domain}`)) throw new Error('promote: evidence page must belong to the reviewed official domain');
}

export async function requireSourceIdentity(tx: Prisma.TransactionClient, source: Source): Promise<void> {
  // A later contradiction supersedes an earlier verification; do not select
  // only VERIFIED rows and accidentally resurrect an invalidated decision.
  const review = await tx.sourceIdentityReview.findFirst({ where: { sourceKey: source.key }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  assertIdentityReview(source, review);
}

/** Records an explicit reviewer decision, never an automatically scored name. */
export async function recordSourceIdentityReview(prisma: PrismaClient, document: SourceIdentityReview, artifact: Uint8Array, apply = false) {
  return prisma.$transaction(async tx => {
    await lockSourceWrites(tx, document.sourceKey, true);
    const source = await tx.source.findUniqueOrThrow({ where: { key: document.sourceKey } });
    if (!artifact.length || artifact.length > 2 * 1024 * 1024) throw new Error('Identity evidence must be a nonempty UTF-8 document of at most 2 MiB');
    const artifactText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(artifact);
    const review = { ...document, artifactText, checkedAt: new Date(document.checkedAt) };
    if (!['VERIFIED', 'CONTRADICTED', 'UNRESOLVED'].includes(review.verdict)) throw new Error('Unknown identity verdict');
    // Every decision must identify the exact source and preserve its evidence.
    assertIdentityReview(source, { ...review, verdict: 'VERIFIED' });
    if (createHash('sha256').update(artifact).digest('hex') !== review.artifactHash) throw new Error('Identity artifact hash mismatch');
    const { sourceKey, tenantKey, subjectKey, sourceHash, verdict, method, officialDomain, proofUrl, portalUrl, statement, artifactHash, reviewer, checkedAt } = review;
    const data = { sourceKey, tenantKey, subjectKey, sourceHash, verdict, method, officialDomain, proofUrl, portalUrl, statement, artifactHash, artifactText, reviewer, checkedAt };
    if (apply) await tx.sourceIdentityReview.create({ data });
    return { sourceKey, sourceHash, verdict, written: apply ? 1 : 0 };
  });
}
