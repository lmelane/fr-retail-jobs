import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { upsertDeduplicated } from './upsert.js';
import { resolveCompany } from '../normalize/company.js';
import type { CandidateJob } from './match.js';

/**
 * Integration tests for write-time dedup, focused on the unique-constraint
 * recovery seen live on Kering: six workers, two copies of the same feed entry,
 * both pass the cluster lookup before either writes.
 *
 * Two unique keys can be violated by that race — Job(companyId, source,
 * externalId) AND JobSource(sourceKey, externalId) — and the recovery must
 * survive BOTH, attaching the loser to the winner instead of throwing the
 * offer away (which is what happened: "kering write failed").
 */
const prisma = new PrismaClient();

async function wipe() {
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.company.deleteMany({});
}

function candidate(
  over: Partial<CandidateJob> & { sourceKey: string; externalId: string; company: string; title: string },
): CandidateJob & { companyId: string } {
  return {
    sourceTier: 'EMPLOYER_DIRECT',
    atsType: 'GENERIC_JSONLD',
    raw: {},
    ...over,
    url: over.url ?? `https://x/${over.externalId}`,
    description: over.description ?? 'desc',
    companyId: resolveCompany(over.company).companyId,
  } as CandidateJob & { companyId: string };
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('upsertDeduplicated — unique-constraint recovery', () => {
  it('CREATES the first posting', async () => {
    const result = await upsertDeduplicated(
      prisma,
      candidate({ sourceKey: 'kering', externalId: 'K1', company: 'Gucci', title: 'Vendeur', location: 'Paris' }),
    );
    expect(result.outcome).toBe('CREATED');
    expect(await prisma.job.count()).toBe(1);
  });

  it('does not throw when a (sourceKey, externalId) collides but the Job unique key does NOT match the winner', async () => {
    // First job: source kering / K1, written with atsType WORKDAY.
    await upsertDeduplicated(
      prisma,
      candidate({ sourceKey: 'kering', externalId: 'K1', company: 'Gucci', title: 'Vendeur', location: 'Paris', atsType: 'WORKDAY' }),
    );

    // A second posting in a DIFFERENT cluster (Lyon) carrying the SAME
    // (sourceKey, externalId) but a DIFFERENT atsType (GENERIC_JSONLD). This is
    // the exact shape that made Kering throw and lose an offer: the JobSource
    // unique key (kering, K1) collides, but the recovery looks up the winner by
    // (companyId, source=GENERIC_JSONLD, externalId) — which does NOT exist,
    // because the winner was written with source=WORKDAY. Old code: winner is
    // null → re-throw → offer lost.
    const result = await upsertDeduplicated(
      prisma,
      candidate({ sourceKey: 'kering', externalId: 'K1', company: 'Gucci', title: 'Directeur', location: 'Lyon', atsType: 'GENERIC_JSONLD' }),
    );

    // It must resolve, not throw. The offer attaches to the row that owns K1.
    expect(['MERGED', 'UPDATED']).toContain(result.outcome);
    // Exactly one JobSource for (kering, K1) — the unique key is intact.
    expect(await prisma.jobSource.count({ where: { sourceKey: 'kering', externalId: 'K1' } })).toBe(1);
  });

  it('recovers from the concurrent create of the SAME opening (Job unique key)', async () => {
    // Same opening written twice with identical keys: the classic race the
    // catch block was written for. Still must not throw.
    const first = await upsertDeduplicated(
      prisma,
      candidate({ sourceKey: 'kering', externalId: 'K2', company: 'Gucci', title: 'Vendeur', location: 'Paris' }),
    );
    const second = await upsertDeduplicated(
      prisma,
      candidate({ sourceKey: 'kering', externalId: 'K2', company: 'Gucci', title: 'Vendeur', location: 'Paris' }),
    );
    expect(first.outcome).toBe('CREATED');
    expect(['MERGED', 'UPDATED']).toContain(second.outcome);
    expect(await prisma.job.count()).toBe(1);
  });
});

/**
 * Regression for the dead-link fix not reaching stored rows: an adapter URL
 * correction must propagate to offers ALREADY in the base on the next ingest,
 * not only to newly-created ones. Before this, a re-ingest of the same source
 * left the old (404) URL untouched, so fixing the adapter changed nothing live.
 */
describe('upsertDeduplicated — URL refresh on re-ingest', () => {
  it('rewrites Job.url when the same source re-reports the offer with a corrected URL', async () => {
    const created = await upsertDeduplicated(
      prisma,
      candidate({
        sourceKey: 'richemont',
        externalId: 'JR1',
        company: 'Cartier',
        title: 'Vendeur',
        location: 'Paris',
        url: 'https://richemont.wd3.myworkdayjobs.com/job/PARIS/Vendeur_JR1', // old, 404
      }),
    );
    expect(created.outcome).toBe('CREATED');

    // Same offer, same source, corrected URL (the adapter fix).
    await upsertDeduplicated(
      prisma,
      candidate({
        sourceKey: 'richemont',
        externalId: 'JR1',
        company: 'Cartier',
        title: 'Vendeur',
        location: 'Paris',
        url: 'https://richemont.wd3.myworkdayjobs.com/broadbean_external/job/PARIS/Vendeur_JR1', // fixed, 200
      }),
    );

    const job = await prisma.job.findFirstOrThrow({ where: { externalId: 'JR1' } });
    expect(job.url).toBe(
      'https://richemont.wd3.myworkdayjobs.com/broadbean_external/job/PARIS/Vendeur_JR1',
    );
    expect(await prisma.job.count()).toBe(1);
  });

  it('does NOT let a lower-tier jobboard overwrite the employer canonical URL (D18)', async () => {
    // Employer-direct source owns the canonical link.
    await upsertDeduplicated(
      prisma,
      candidate({
        sourceKey: 'gucci',
        externalId: 'G9',
        company: 'Gucci',
        title: 'Conseiller de vente',
        location: 'Paris',
        sourceTier: 'EMPLOYER_DIRECT',
        url: 'https://employer.example/apply/G9',
      }),
    );

    // A jobboard (lower tier) lists the same opening with its own URL. It must
    // attach as a source but must NOT hijack the canonical apply URL.
    await upsertDeduplicated(
      prisma,
      candidate({
        sourceKey: 'wttj',
        externalId: 'W9',
        company: 'Gucci',
        title: 'Conseiller de vente',
        location: 'Paris',
        sourceTier: 'SPECIALIST_JOBBOARD',
        url: 'https://jobboard.example/job/W9',
      }),
    );

    const job = await prisma.job.findFirstOrThrow({ where: { externalId: 'G9' } });
    expect(job.url).toBe('https://employer.example/apply/G9'); // still the employer
  });
});
