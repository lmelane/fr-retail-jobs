import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { purgeStaleForSource } from './purge.js';

/**
 * Integration tests for the per-source generation purge (decision D6).
 *
 * The purge must NEVER empty the base when a run fails, and must only remove a
 * source's OWN stale rows — never a still-live offer that another source keeps.
 * These run against the local audit Postgres (DATABASE_URL), and each test
 * starts from a clean slate.
 */

const prisma = new PrismaClient();
const CURRENT = 5;

async function wipe() {
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.company.deleteMany({});
}

async function makeCompany(id: string, name: string) {
  return prisma.company.create({
    data: { name, canonicalKey: id, fashionjobsUrl: `resolved:${id}` },
  });
}

/** A job with one source at a given pipeline version. */
async function makeJob(opts: {
  companyId: string;
  externalId: string;
  version: number;
  sources: { sourceKey: string; externalId: string }[];
}) {
  return prisma.job.create({
    data: {
      companyId: opts.companyId,
      externalId: opts.externalId,
      source: 'GENERIC_JSONLD',
      title: 'Vendeur',
      url: `https://x/${opts.externalId}`,
      fingerprint: `fp-${opts.externalId}`,
      pipelineVersion: opts.version,
      isActive: true,
      sources: {
        create: opts.sources.map((s) => ({
          sourceKey: s.sourceKey,
          sourceTier: 'ATS_OFFICIAL',
          externalId: s.externalId,
          url: `https://x/${s.externalId}`,
          isActive: true,
        })),
      },
    },
    include: { sources: true },
  });
}

beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('purgeStaleForSource', () => {
  it('removes a stale single-source job that this source no longer lists', async () => {
    const c = await makeCompany('acme', 'Acme');
    // Stale (v4) job whose only source is "kering" — kering's run just succeeded
    // at v5 without re-seeing it, so it is gone from kering.
    await makeJob({ companyId: c.id, externalId: 'old1', version: CURRENT - 1, sources: [{ sourceKey: 'kering', externalId: 'k-old1' }] });

    const result = await purgeStaleForSource(prisma, 'kering', CURRENT);

    expect(result.jobsDeleted).toBe(1);
    expect(await prisma.job.count()).toBe(0);
  });

  it('keeps a job that another source still lists, only detaching the stale source', async () => {
    const c = await makeCompany('acme', 'Acme');
    // v4 job seen by BOTH kering (stale) and loreal (still live at v5 elsewhere).
    const job = await makeJob({
      companyId: c.id,
      externalId: 'shared1',
      version: CURRENT - 1,
      sources: [
        { sourceKey: 'kering', externalId: 'k-shared1' },
        { sourceKey: 'loreal', externalId: 'l-shared1' },
      ],
    });

    const result = await purgeStaleForSource(prisma, 'kering', CURRENT);

    // The job survives because loreal still carries it.
    expect(result.jobsDeleted).toBe(0);
    const still = await prisma.job.findUnique({ where: { id: job.id }, include: { sources: true } });
    expect(still).not.toBeNull();
    // kering's stale source row is gone; loreal remains.
    const keys = still!.sources.map((s) => s.sourceKey).sort();
    expect(keys).toEqual(['loreal']);
  });

  it('never touches a current-version job of the same source', async () => {
    const c = await makeCompany('acme', 'Acme');
    await makeJob({ companyId: c.id, externalId: 'fresh1', version: CURRENT, sources: [{ sourceKey: 'kering', externalId: 'k-fresh1' }] });

    const result = await purgeStaleForSource(prisma, 'kering', CURRENT);

    expect(result.jobsDeleted).toBe(0);
    expect(await prisma.job.count()).toBe(1);
  });

  it('never touches jobs belonging to a different source', async () => {
    const c = await makeCompany('acme', 'Acme');
    // Stale loreal job — purging kering must not remove it.
    await makeJob({ companyId: c.id, externalId: 'lor-old', version: CURRENT - 1, sources: [{ sourceKey: 'loreal', externalId: 'l-old' }] });

    const result = await purgeStaleForSource(prisma, 'kering', CURRENT);

    expect(result.jobsDeleted).toBe(0);
    expect(await prisma.job.count()).toBe(1);
  });
});
