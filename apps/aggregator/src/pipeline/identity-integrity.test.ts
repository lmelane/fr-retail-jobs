import '../test/setup-integration.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { upsertDeduplicated } from '../dedup/upsert.js';
import type { CandidateJob } from '../dedup/match.js';
import { resolveCompany } from '../normalize/company.js';
import { lockCompanyRows } from '../lib/writeLocks.js';
import { retireSource } from './retireSource.js';
import { withSourceBudget } from '../lib/sourceBudget.js';

const prisma = new PrismaClient();
const candidate = (overrides: Partial<CandidateJob> = {}): CandidateJob & { companyId: string } => ({
  company: 'Dior', companyId: resolveCompany('Dior').companyId,
  sourceKey: 'employer', externalId: '1', sourceTier: 'EMPLOYER_DIRECT', atsType: 'WORKDAY',
  title: 'Store Manager', city: 'Paris', country: 'FR', location: 'Paris, France',
  url: 'https://employer.example/1', description: 'Authoritative description', salaryMin: 50000,
  salaryCurrency: 'EUR', raw: { revision: 1 }, ...overrides,
});

beforeEach(async () => {
  await prisma.jobSource.deleteMany();
  await prisma.job.deleteMany();
  await prisma.company.deleteMany();
  await prisma.sourceObservation.deleteMany();
});
afterAll(() => prisma.$disconnect());

describe('transactional identity and source authority', () => {
  it('retirement preserves history and blocks a previously fetched source from writing again', async () => {
    await prisma.source.upsert({ where: { key: 'retirement-race' }, update: { status: 'ACTIVE' }, create: {
      key: 'retirement-race', maison: 'Dior', kind: 'workday', config: {},
      tenantKey: 'workday:retirement-race', tier: 'EMPLOYER_DIRECT', status: 'ACTIVE',
    } });
    const first = await upsertDeduplicated(prisma, candidate({ sourceKey: 'retirement-race' }));
    const outcomes = await Promise.all(Array.from({ length: 3 }, () => retireSource(prisma, 'retirement-race')));
    expect(outcomes.reduce((n, x) => n + x.jobsClosed, 0)).toBe(0);
    expect(outcomes.reduce((n, x) => n + x.jobsWithdrawn, 0)).toBe(1);
    await expect(upsertDeduplicated(prisma, candidate({ sourceKey: 'retirement-race' }))).rejects.toThrow('RETIRED');
    expect(await prisma.job.findUniqueOrThrow({ where: { id: first.jobId } })).toMatchObject({ isActive: false });
    expect(await prisma.jobEvent.count({ where: { jobId: first.jobId, type: 'OPENED' } })).toBe(1);
    expect(await prisma.jobEvent.count({ where: { jobId: first.jobId, type: 'CLOSED' } })).toBe(0);
    expect(await prisma.jobEvent.count({ where: { jobId: first.jobId, type: 'WITHDRAWN' } })).toBe(1);
    expect(await prisma.sourceObservation.count()).toBe(1);
    await prisma.source.delete({ where: { key: 'retirement-race' } });
  });

  it('does not write after a deadline while waiting for a lifecycle lock', async () => {
    const first = await upsertDeduplicated(prisma, candidate());
    const job = await prisma.job.findUniqueOrThrow({ where: { id: first.jobId } });
    let ready!: () => void, release!: () => void;
    const held = new Promise<void>(resolve => { ready = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const blocker = prisma.$transaction(async tx => {
      await lockCompanyRows(tx, [job.companyId]);
      ready();
      await released;
    });
    await held;
    const pending = withSourceBudget(() => upsertDeduplicated(prisma,
      candidate({ title: 'Changed after cancellation', raw: { revision: 2 } })), 20, 'locked-source');
    const check = expect(pending).rejects.toThrow('__TIMEOUT__ locked-source');
    await new Promise(resolve => setTimeout(resolve, 70));
    release();
    await blocker;
    await check;
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).title).toBe('Store Manager');
    expect(await prisma.sourceObservation.count()).toBe(1);
  });
  it('serializes simultaneous copies from independent feeds into one job', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      upsertDeduplicated(prisma, candidate({ sourceKey: `feed-${i}`, externalId: `id-${i}` })),
    ));
    expect(new Set(results.map(r => r.jobId)).size).toBe(1);
    expect(await prisma.jobSource.count()).toBe(12);
    expect(await prisma.jobEvent.count({ where: { type: 'OPENED' } })).toBe(1);
  });

  it('does not equate IDs from separate tenants of the same ATS', async () => {
    await Promise.all([
      upsertDeduplicated(prisma, candidate()),
      upsertDeduplicated(prisma, candidate({ sourceKey: 'other-tenant', country: 'US', location: 'Paris, US' })),
    ]);
    expect(await prisma.job.count()).toBe(2);
    expect(await prisma.jobSource.count()).toBe(2);
  });

  it('preserves exact source identity through concurrent relocation', async () => {
    const results = await Promise.all([
      upsertDeduplicated(prisma, candidate()),
      upsertDeduplicated(prisma, candidate({ city: 'Lyon', location: 'Lyon, France' })),
    ]);
    expect(results[0].jobId).toBe(results[1].jobId);
    expect(await prisma.jobSource.count()).toBe(1);
  });

  it('a known jobboard cannot overwrite employer content, geography or salary', async () => {
    const first = await upsertDeduplicated(prisma, candidate());
    const board = candidate({ sourceKey: 'board', externalId: 'b1', sourceTier: 'SPECIALIST_JOBBOARD', url: 'https://board.example/1' });
    await upsertDeduplicated(prisma, board);
    await upsertDeduplicated(prisma, { ...board, title: 'Assistant Store Manager', salaryMin: 25000, country: 'US', raw: { revision: 2 } });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: first.jobId } });
    expect(job).toMatchObject({ title: 'Store Manager', countryCode: 'FR', salaryMin: 50000, canonicalSourceKey: 'employer', raw: { revision: 1 } });
    const source = await prisma.jobSource.findUniqueOrThrow({ where: { sourceKey_externalId: { sourceKey: 'board', externalId: 'b1' } } });
    expect(source.raw).toEqual({ revision: 2 });
  });

  it('keeps distinct payload revisions and accepts a shorter employer correction', async () => {
    await upsertDeduplicated(prisma, candidate());
    const update = candidate({ description: 'Corrected', raw: { revision: 2 } });
    await upsertDeduplicated(prisma, update);
    await upsertDeduplicated(prisma, update);
    expect(await prisma.sourceObservation.count()).toBe(2);
    expect(await prisma.job.findFirstOrThrow()).toMatchObject({ description: 'Corrected', raw: { revision: 2 } });
    expect(await prisma.jobSource.findFirstOrThrow()).toMatchObject({ raw: { revision: 2 } });
    await expect(prisma.job.deleteMany()).rejects.toThrow();
    expect(await prisma.sourceObservation.count()).toBe(2);
    expect(await prisma.occupationObservation.count()).toBeGreaterThan(0);
  });

  it('rolls back observations and company creation when the job write fails', async () => {
    await expect(upsertDeduplicated(prisma, candidate({ salaryMin: 1e15 }))).rejects.toThrow();
    expect(await prisma.job.count()).toBe(0);
    expect(await prisma.company.count()).toBe(0);
    expect(await prisma.sourceObservation.count()).toBe(0);
  });

  it('an inactive employer cannot retain ownership after a board is reattested', async () => {
    await upsertDeduplicated(prisma, candidate());
    const board = candidate({ sourceKey: 'board', externalId: 'b1', sourceTier: 'SPECIALIST_JOBBOARD', url: 'https://board.example/1' });
    await upsertDeduplicated(prisma, board);
    await prisma.jobSource.updateMany({ where: { sourceKey: 'employer' }, data: { isActive: false } });
    await upsertDeduplicated(prisma, board);
    expect(await prisma.job.findFirstOrThrow()).toMatchObject({ canonicalSourceKey: 'board', url: board.url });
  });
});
