import { upsertDeduplicated } from '../test/publicationPersistenceFixture.js';
import { publicationContentOf } from '@catwalks/db/publication-presentation';
import '../test/setup-integration.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { CandidateJob } from '../dedup/match.js';
import { resolveCompany } from '../normalize/company.js';
import { lockCompanyRows } from '../lib/writeLocks.js';
import { retireSource } from './retireSource.js';
import { withSourceBudget } from '../lib/sourceBudget.js';

const prisma = new PrismaClient();
const nativeRaw = { source: 'oraclehcm', site: 'CX', list: { Id: '1' } };
const candidate = (overrides: Partial<CandidateJob> = {}): CandidateJob & { companyId: string } => ({
  company: 'Dior', companyId: resolveCompany('Dior').companyId,
  sourceKey: 'employer', externalId: '1', sourceTier: 'EMPLOYER_DIRECT', atsType: 'WORKDAY',
  title: 'Store Manager', city: 'Paris', country: 'FR', location: 'Paris, France',
  url: 'https://example.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1', description: 'Authoritative description', salaryMin: 50000,
  salaryCurrency: 'EUR', ...overrides, raw: { ...nativeRaw, ...(overrides.raw as object ?? { revision: 1 }) },
});

beforeEach(async () => {
  await prisma.jobSource.deleteMany();
  await prisma.job.deleteMany();
  await prisma.company.deleteMany();
  await prisma.sourceObservation.deleteMany();
});
afterAll(() => prisma.$disconnect());

describe('transactional identity and source authority', () => {
  it('concurrent administrative retirement preserves history idempotently', async () => {
    await prisma.source.upsert({ where: { key: 'retirement-race' }, update: { status: 'ACTIVE' }, create: {
      key: 'retirement-race', maison: 'Dior', kind: 'workday', config: {},
      tenantKey: 'workday:retirement-race', tier: 'EMPLOYER_DIRECT', status: 'ACTIVE',
    } });
    const first = await upsertDeduplicated(prisma, candidate({ sourceKey: 'retirement-race' }));
    const outcomes = await Promise.all(Array.from({ length: 3 }, () => retireSource(prisma, 'retirement-race')));
    expect(outcomes.reduce((n, x) => n + x.jobsClosed, 0)).toBe(0);
    expect(outcomes.reduce((n, x) => n + x.jobsWithdrawn, 0)).toBe(1);
    // Refusal of a previously fetched admitted capture is tested without mocks
    // in publicationBoundary.test.ts; this fixture isolates persistence.
    expect(await prisma.job.findUniqueOrThrow({ where: { id: first.jobId } })).toMatchObject({ isActive: false });
    expect(await prisma.jobEvent.count({ where: { jobId: first.jobId, type: 'OPENED' } })).toBe(1);
    expect(await prisma.jobEvent.count({ where: { jobId: first.jobId, type: 'CLOSED' } })).toBe(0);
    expect(await prisma.jobEvent.count({ where: { jobId: first.jobId, type: 'WITHDRAWN' } })).toBe(1);
    expect(await prisma.sourceObservation.count()).toBe(1);
    await prisma.source.delete({ where: { key: 'retirement-race' } });
  });

  it('does not mutate a job after a deadline while keeping the observation received before the lifecycle lock', async () => {
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
    expect(await prisma.sourceObservation.count()).toBe(2);
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
      upsertDeduplicated(prisma, candidate({ sourceKey: 'other-tenant', url: 'https://other.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1', country: 'US', location: 'Paris, US' })),
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
    const first = await upsertDeduplicated(prisma, candidate({ atsType: 'LEVER', raw: { revision: 1, salaryRange: { min: 50000, currency: 'EUR', interval: 'per-year-salary' } } }));
    const board = candidate({ sourceKey: 'board', externalId: 'b1', sourceTier: 'SPECIALIST_JOBBOARD', url: 'https://example.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1?utm_source=board', atsType: 'LEVER' });
    await upsertDeduplicated(prisma, board);
    const boardRaw = { ...nativeRaw, revision: 2, salaryRange: { min: 25000, currency: 'USD', interval: 'per-year-salary' } };
    await upsertDeduplicated(prisma, { ...board, title: 'Assistant Store Manager', salaryMin: 25000, country: 'US', raw: boardRaw });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: first.jobId } });
    expect(job).toMatchObject({ title: 'Store Manager', countryCode: 'FR', canonicalSourceKey: 'employer', raw: { revision: 1 } });
    expect(job.salaryMin?.toString()).toBe('50000');
    const source = await prisma.jobSource.findUniqueOrThrow({ where: { sourceKey_externalId: { sourceKey: 'board', externalId: 'b1' } } });
    expect(source.raw).toEqual(boardRaw);
  });

  it('does not borrow missing content or employment fields from a secondary publication', async () => {
    const empty = candidate({ description: undefined, country: undefined, city: undefined, location: undefined });
    const first = await upsertDeduplicated(prisma, empty);
    const before = await prisma.job.findUniqueOrThrow({ where: { id: first.jobId } });
    await upsertDeduplicated(prisma, candidate({ sourceKey: 'board', externalId: 'board-1', sourceTier: 'SPECIALIST_JOBBOARD',
      description: 'Board-only description', department: 'Board-only department', country: 'US', city: 'Boston', location: 'Boston, US',
      employmentTerm: 'FIXED_TERM', workTime: 'PART_TIME', workSchedule: 'NIGHT_SHIFT', rawSchedule: 'Night shift',
      language: 'en', postedAt: new Date('2026-09-01'), experienceYears: 7 }));
    const after = await prisma.job.findUniqueOrThrow({ where: { id: first.jobId } });
    for (const key of ['title', 'description', 'department', 'countryCode', 'city', 'location', 'employmentTerm', 'workTime',
      'workSchedule', 'rawSchedule', 'language', 'postedAt', 'experienceYears', 'occupationEvidence'] as const) {
      expect(after[key], key).toEqual(before[key]);
    }
    expect(await prisma.jobSource.count({ where: { jobId: first.jobId } })).toBe(2);
  });

  it('clears optional values absent from the new observation of the selected publication', async () => {
    const first = await upsertDeduplicated(prisma, candidate({ department: 'Retail', postedAt: new Date('2026-09-01'),
      experienceYears: 7, rawContract: 'CDD', rawWorkingTime: 'Part time', employmentTerm: 'FIXED_TERM', workTime: 'PART_TIME',
      workSchedule: 'NIGHT_SHIFT', rawSchedule: 'Night shift', employmentEvidence: { revision: 1 } }));
    await upsertDeduplicated(prisma, candidate({ title: 'Client Advisor', description: undefined, country: undefined,
      city: undefined, location: undefined, raw: { revision: 2 } }));
    const job = await prisma.job.findUniqueOrThrow({ where: { id: first.jobId } });
    expect(job).toMatchObject({ title: 'Client Advisor', description: null, department: null, postedAt: null,
      countryCode: null, countryIntegrity: null, city: null, location: null, adminArea1: null,
      experienceYears: null, rawContract: null, rawWorkingTime: null, employmentEvidence: null,
      employmentTerm: null, workTime: null, workSchedule: null, rawSchedule: null });
    expect(await prisma.jobEvent.count({ where: { jobId: job.id, type: 'CHANGED', field: 'country', before: 'FR', after: null } })).toBe(1);
    const events = await prisma.jobEvent.count({ where: { jobId: job.id, type: 'CHANGED' } });
    await upsertDeduplicated(prisma, candidate({ title: 'Client Advisor', description: undefined, country: undefined,
      city: undefined, location: undefined, raw: { revision: 2 } }));
    expect(await prisma.jobEvent.count({ where: { jobId: job.id, type: 'CHANGED' } })).toBe(events);
  });

  it('replaces the whole presentation when an employer takes over a board publication', async () => {
    const first = await upsertDeduplicated(prisma, candidate({ sourceKey: 'board', externalId: 'board-1',
      sourceTier: 'SPECIALIST_JOBBOARD', department: 'Board department', description: 'Board text', experienceYears: 7 }));
    await upsertDeduplicated(prisma, candidate({ sourceKey: 'employer', externalId: 'employer-1', atsType: 'ORACLE_HCM',
      title: 'Employer title', description: undefined, country: undefined, location: undefined, city: undefined }));
    const job = await prisma.job.findUniqueOrThrow({ where: { id: first.jobId } });
    expect(job).toMatchObject({ canonicalSourceKey: 'employer', canonicalExternalId: 'employer-1', externalId: 'employer-1',
      source: 'ORACLE_HCM', title: 'Employer title', description: null, countryCode: null, city: null, department: null, experienceYears: null });
  });

  it('invalidates the presentation if its RAW changes without a new projection', async () => {
    const input = candidate(); const first = await upsertDeduplicated(prisma, input);
    const before = await prisma.jobSource.findFirstOrThrow({ where: { jobId: first.jobId } });
    expect(publicationContentOf(before)?.title).toBe(input.title);
    await prisma.jobSource.update({ where: { id: before.id }, data: { raw: { changed: true } } });
    expect((await prisma.jobSource.findUniqueOrThrow({ where: { id: before.id } })).presentation).toBeNull();
    await upsertDeduplicated(prisma, input);
    expect(publicationContentOf(await prisma.jobSource.findUniqueOrThrow({ where: { id: before.id } }))?.title).toBe(input.title);
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

  it('keeps observations and rolls back company creation when the job write fails', async () => {
    await expect(upsertDeduplicated(prisma, candidate({ experienceYears: 1e15 }))).rejects.toThrow();
    expect(await prisma.job.count()).toBe(0);
    expect(await prisma.company.count()).toBe(0);
    expect(await prisma.sourceObservation.count()).toBe(1);
  });

  it('an inactive employer cannot retain ownership after a board is reattested', async () => {
    await upsertDeduplicated(prisma, candidate());
    const board = candidate({ sourceKey: 'board', externalId: 'b1', sourceTier: 'SPECIALIST_JOBBOARD', url: 'https://example.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/1?utm_source=board' });
    await upsertDeduplicated(prisma, board);
    await prisma.jobSource.updateMany({ where: { sourceKey: 'employer' }, data: { isActive: false } });
    await upsertDeduplicated(prisma, board);
    expect(await prisma.job.findFirstOrThrow()).toMatchObject({ canonicalSourceKey: 'board', url: board.url });
  });
});
