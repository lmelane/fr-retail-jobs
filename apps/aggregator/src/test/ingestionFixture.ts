import { vi } from 'vitest';
import type { PrismaClient, Source } from '@prisma/client';
import { captureExtraction } from '../capture/batch.js';
import { fetchAtsJobs } from '../ats/index.js';
import { ingestionQualifications } from '../connectors/sourceAdmission.js';
import { effectiveSourceConfig } from '../connectors/sourceConfig.js';
import { validateCapturedSource } from '../connectors/sourceValidation.js';
import { admissionFixture } from './sourceAdmissionFixture.js';
import { runIngest, type IngestStats } from '../pipeline/ingest.js';
import { resolveCompany } from '../normalize/company.js';

/** The Company row the production ingestion of this source resolves its postings to. A test job
 * that must be re-attested by a feed has to belong to it; any other owner is a real identity
 * refusal (`EmployerIdentityReviewRequired`), which the ingestion records as a write failure. */
export async function resolvedCompany(db: PrismaClient, sourceKey: string) {
  const { companyId, displayName } = resolveCompany(sourceKey);
  return db.company.upsert({ where: { fashionjobsUrl: `resolved:${companyId}` },
    create: { name: displayName, canonicalKey: companyId, fashionjobsUrl: `resolved:${companyId}` }, update: {} });
}

/**
 * Real ingestion of a synthetic native feed. Only upstream HTTP is synthetic: the
 * registry, identity/access/qualification gates, admission SQL, capture, sealed
 * manifest, publication writers and the immutable end-of-ingestion report all run
 * unchanged. This is how tests obtain an attesting capture; there is no shortcut
 * that fabricates one, in tests or in production.
 */
export type SyntheticPosting = {
  /** Omit to produce a row the adapter cannot name (anonymous rejection). */
  id?: string;
  /** Omit to produce a row the adapter rejects while still naming it. */
  title?: string | null;
  listed?: boolean; url?: string; description?: string;
};

export function syntheticFeed(postings: readonly SyntheticPosting[]): string {
  return JSON.stringify({ apiVersion: '1', jobs: postings.map(posting => ({
    ...(posting.id !== undefined ? { id: posting.id } : {}),
    ...(posting.title === null ? {} : { title: posting.title ?? `Poste ${posting.id ?? 'sans identifiant'}` }),
    isListed: posting.listed ?? true, descriptionPlain: posting.description ?? 'Native responsibilities',
    ...(posting.url ? { jobUrl: posting.url } : {}),
  })) });
}

async function withNetwork<T>(body: string | (() => Promise<Response>), work: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(typeof body === 'string' ? async () => new Response(body) : body));
  try { return await work(); } finally { vi.stubGlobal('fetch', previous); }
}

/** An ACTIVE Ashby source holding current identity, access and technical qualification decisions.
 * Re-qualifies through the real onboarding gates whenever the current decisions no longer admit an ingestion. */
export async function qualifiedSource(db: PrismaClient, key: string): Promise<Source> {
  let source = await db.source.findUnique({ where: { key } });
  if (source && source.status !== 'ACTIVE') source = await db.source.update({ where: { key }, data: { status: 'ACTIVE' } });
  source ??= await db.source.create({ data: { key, maison: key, tenantKey: `ashby:${key}`, kind: 'ashby', config: { board: key }, tier: 'EMPLOYER_DIRECT', status: 'ACTIVE' } });
  const admitted = await ingestionQualifications(db, key).then(() => true, () => false);
  if (!admitted) {
    const registry = source;
    await withNetwork(syntheticFeed([{ id: `${key}-calibration`, title: 'Calibration' }]), async () => {
      const probe = await captureExtraction(db, key, registrySettings(registry), undefined, settings => fetchAtsJobs('ASHBY', settings), 'ASHBY');
      await admissionFixture(db, registry, probe.captureBatchId);
    });
  }
  return source;
}

/** The exact registered settings: a capture with other settings is refused by the registry binding. */
const registrySettings = (source: Source) => effectiveSourceConfig(source.config as Record<string, unknown>);

/** Run the production ingestion of one source against a synthetic feed body or transport. */
export async function ingestSyntheticFeed(db: PrismaClient, key: string, feed: readonly SyntheticPosting[] | string | (() => Promise<Response>)): Promise<IngestStats> {
  await qualifiedSource(db, key);
  const body = Array.isArray(feed) ? syntheticFeed(feed as SyntheticPosting[]) : feed as string | (() => Promise<Response>);
  return withNetwork(body, async () => {
    const [stats] = await runIngest(db, { only: key, skipGeocode: true });
    if (!stats) throw new Error('Ingestion produced no statistics');
    return stats;
  });
}

/** A source can only attest absence from its second productive collection: the first
 * has no past to compare against (status NEW). Ingest the same feed twice. */
export async function attestSyntheticFeed(db: PrismaClient, key: string, postings: readonly SyntheticPosting[]): Promise<IngestStats> {
  if (postings.length) await ingestSyntheticFeed(db, key, postings);
  return ingestSyntheticFeed(db, key, postings);
}

/** An admitted, validated collection whose publication loop never ran: no completion, no absence proof. */
export async function collectAdmittedWithoutCompletion(db: PrismaClient, key: string, postings: readonly SyntheticPosting[]) {
  const source = await qualifiedSource(db, key);
  return withNetwork(syntheticFeed(postings), async () => {
    const batch = await captureExtraction(db, key, registrySettings(source), undefined, settings => fetchAtsJobs('ASHBY', settings), 'ASHBY',
      { revisionId: source.currentRevisionId, requireActive: true });
    await validateCapturedSource(db, batch.captureBatchId);
    return batch;
  });
}

/** End-of-file cleanup, like every suite that qualifies sources: identity reviews reference the
 * registry with RESTRICT, so a later suite's `source.deleteMany` must not be blocked by them. */
export async function releaseQualifiedSources(db: PrismaClient) {
  await db.$executeRaw`TRUNCATE "SourceIngestionAdmission", "SourceIdentityReview"`;
}

export const latestBatch = (db: PrismaClient, key: string) => db.captureBatch.findFirstOrThrow({
  where: { sourceKey: key, purpose: 'JOBS' }, orderBy: { attemptOrdinal: 'desc' }, include: { outcome: true, ingestionAdmission: true, ingestionCompletion: true } });
