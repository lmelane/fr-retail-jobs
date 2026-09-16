import { accessFixture } from '../test/sourceAccessFixture.js';
import { recordSourceAccessDecision } from '../connectors/sourceAccess.js';
import { captureIdentityFixture } from '../test/sourceIdentityFixture.js';
import { recordSourceIdentityReview } from '../connectors/sourceIdentity.js';
import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { captureExtraction } from '../capture/batch.js';
import { fetchAtsJobs } from '../ats/index.js';
import { validateCapturedSource } from '../connectors/sourceValidation.js';
import * as certification from '../connectors/sourceCertification.js';
import {
  importSourcesCsv,
  loadActiveSources,
  promoteSource,
  tenantKeyOf,
} from '../connectors/sourceStore.js';
import { retireSource } from './retireSource.js';
import { loadSourceCatalog } from '../connectors/sourceCatalog.js';

/**
 * DEC-3 — the catalogue lives in the Source table, with a lifecycle.
 *
 * What a CSV never enforced and the table must: seeding is idempotent, the
 * same ATS tenant cannot be catalogued twice, an unseeded base refuses to
 * ingest instead of quietly running zero sources, and promotion/retirement
 * are guarded state transitions, not hand edits.
 */

const prisma = new PrismaClient();

async function wipe() {
  // This file is guarded by setup-integration and only runs on a test DB.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "SourceIdentityReview"');
  await prisma.jobSource.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.company.deleteMany({});
  await prisma.source.deleteMany({});
}

beforeEach(wipe);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('tenantKeyOf', () => {
  it('normalizes the primary endpoint whatever the config shape', () => {
    expect(tenantKeyOf('workday', '{"origin": "https://richemont.wd3.myworkdayjobs.com/Richemont"}')).toBe(
      'workday:richemont.wd3.myworkdayjobs.com/richemont',
    );
    // A plain-URL row (sitemap source) uses the URL itself.
    expect(tenantKeyOf('generic-listing', 'https://jobs.courir.com/sitemap.xml/')).toBe(
      'generic-listing:jobs.courir.com/sitemap.xml',
    );
    // Same tenant, spelled with/without scheme or trailing slash: same key.
    expect(tenantKeyOf('greenhouse', '{"board": "lacoste"}')).toBe('greenhouse:lacoste');
  });

  it('falls back to careers domain, then maison slug', () => {
    expect(tenantKeyOf('phenom', '{}', 'careers.footlocker.com')).toBe('phenom:careers.footlocker.com');
    expect(tenantKeyOf('phenom', '{}', undefined, 'Foot Locker France')).toBe('phenom:foot-locker-france');
  });
});

describe('importSourcesCsv', () => {
  it('seeds drafts without invented proof and is idempotent', async () => {
    const first = await importSourcesCsv(prisma);
    // EVERY catalogue row must land, so the count is derived from the seed instead of frozen: a hard-coded
    // number turns each new source into a failing test that says nothing about the property under test.
    // What matters is that no row is silently dropped — the tenant consolidation (D-28) removed the 17
    // duplicate rows that re-fetched the same group feed, and FashionJobs left the seed entirely (owner
    // decision 2026-09-11: discovery-only, never a posting source — the seed is re-imported at every boot,
    // so leaving the row there would have rewritten its config back into the catalogue).
    const catalogued = loadSourceCatalog().length;
    expect(catalogued).toBeGreaterThan(0);
    expect(first.imported).toBe(catalogued);
    expect(first.skippedDuplicateTenant).toEqual([]);

    const again = await importSourcesCsv(prisma);
    expect(again.imported).toBe(0);
    expect(again.updated).toBe(0);
    expect(await prisma.source.count()).toBe(first.imported);

    const rows = await loadActiveSources(prisma);
    expect(rows.length).toBe(0);
    // The CSV has no dated evidence and cannot activate a source.
    const sample = await prisma.source.findFirstOrThrow();
    expect(await prisma.sourceAccessDecision.count({ where: { sourceKey: sample.key } })).toBe(0);
    expect(sample.tier).toBeTruthy();
    expect(sample.status).toBe('DRAFT');
  });

  it('preserves operational configuration and real dated evidence on re-import', async () => {
    await importSourcesCsv(prisma);
    const one = await prisma.source.findFirstOrThrow();
    await prisma.source.update({ where: { id: one.id }, data: {
      status: 'ACTIVE', config: { board: 'corrected-live-board' },
      lastRunJobs: 987,
    } });
    await importSourcesCsv(prisma);
    const after = await prisma.source.findUniqueOrThrow({ where: { id: one.id } });
    expect(after.config).toEqual({ board: 'corrected-live-board' });
    expect(after.lastRunJobs).toBe(987);
  });

  it('does not resurrect a RETIRED source on re-import', async () => {
    await importSourcesCsv(prisma);
    const one = await prisma.source.findFirstOrThrow();
    await prisma.source.update({ where: { id: one.id }, data: { status: 'RETIRED' } });

    await importSourcesCsv(prisma);
    const after = await prisma.source.findUniqueOrThrow({ where: { id: one.id } });
    expect(after.status).toBe('RETIRED');
  });
});

describe('loadActiveSources', () => {
  it('refuses an empty catalogue instead of silently running zero sources', async () => {
    await expect(loadActiveSources(prisma)).rejects.toThrow(/import-sources/);
  });

  it('returns only ACTIVE rows', async () => {
    await importSourcesCsv(prisma);
    const one = await prisma.source.findFirstOrThrow();
    await prisma.source.updateMany({ data: { status: 'ACTIVE' } });
    await prisma.source.update({ where: { id: one.id }, data: { status: 'PAUSED' } });
    const rows = await loadActiveSources(prisma);
    expect(rows.find((r) => r.key === one.key)).toBeUndefined();
    expect(rows.length).toBe((await prisma.source.count()) - 1);
  });
});

describe('promoteSource', () => {
  const promote = async (key: string) => {
    const source = await prisma.source.findUniqueOrThrow({ where: { key } });
    return promoteSource(prisma, key, source.currentRevisionId);
  };

  const draft = (over: Record<string, unknown> = {}) => ({
    key: 'test-draft',
    maison: 'Test Maison',
    kind: 'ashby',
    config: { board: 'testmaison' },
    tier: 'ATS_OFFICIAL',
    tenantKey: 'ashby:testmaison',
    status: 'DRAFT' as const,
    ...over,
  });

  async function identity(source: Awaited<ReturnType<typeof prisma.source.create>>) {
    await recordSourceIdentityReview(prisma, await captureIdentityFixture(prisma, source), true);
  }

  async function qualifiedDraft(access = true) {
    const source = await prisma.source.create({ data: draft({ lastRunJobs: 0 }) });
    await identity(source);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ apiVersion: '1', jobs: [{ id: '123', title: 'Client Advisor', isListed: true,
      descriptionPlain: 'Own native duties', jobUrl: 'https://jobs.ashbyhq.com/testmaison/123' }] }))));
    await captureExtraction(prisma, source.key, { board: 'testmaison' }, undefined, config => fetchAtsJobs('ASHBY', config), 'ASHBY');
    const batch = await prisma.captureBatch.findFirstOrThrow({ where: { sourceRevisionId: source.currentRevisionId, purpose: 'JOBS' } });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Qualification must stay offline'); }));
    expect(await validateCapturedSource(prisma, batch.id)).toMatchObject({ verdict: 'VALIDATED' });
    if (access) await accessFixture(prisma, source, batch.id);
    return source;
  }

  it('promotes a natively validated DRAFT even when no previous run reports offers', async () => {
    await qualifiedDraft();
    const result = await promote('test-draft');
    expect(result).toEqual({ key: 'test-draft', from: 'DRAFT', to: 'ACTIVE' });
    const row = await prisma.source.findUniqueOrThrow({ where: { key: 'test-draft' } });
    expect(row.status).toBe('ACTIVE');
  });

  it('requires the revision selected by the operator and preserves an already completed activation on retry', async () => {
    const source = await qualifiedDraft();
    await expect(promoteSource(prisma, source.key, 'different-revision')).rejects.toMatchObject({ name: 'SourcePromotionGateError', code: 'REVISION_MISMATCH' });
    expect((await prisma.source.findUniqueOrThrow({ where: { key: source.key } })).status).toBe('DRAFT');
    await promoteSource(prisma, source.key, source.currentRevisionId);
    const active = await prisma.source.findUniqueOrThrow({ where: { key: source.key } });
    expect(await promoteSource(prisma, source.key, source.currentRevisionId)).toEqual({ key: source.key, from: 'ACTIVE', to: 'ACTIVE' });
    expect(await prisma.source.findUniqueOrThrow({ where: { key: source.key } })).toEqual(active);
  });

  it('holds the registry row while checking technical evidence and committing promotion', async () => {
    const source = await qualifiedDraft();
    const original = certification.requireSourceValidation;
    let unlock!: () => void; const barrier = new Promise<void>(resolve => { unlock = resolve; });
    let locked!: () => void; const ready = new Promise<void>(resolve => { locked = resolve; });
    vi.spyOn(certification, 'requireSourceValidation').mockImplementation(async (...args) => {
      locked(); await barrier; return original(...args);
    });
    const promotion = promote(source.key);
    await ready;
    try {
      await expect(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout='100ms'");
        await tx.source.update({ where: { key: source.key }, data: { note: 'Concurrent registry write' } });
      })).rejects.toThrow();
    } finally { unlock(); await promotion; }
    expect((await prisma.source.findUniqueOrThrow({ where: { key: source.key } })).status).toBe('ACTIVE');
  });

  it('refuses technical success without employer evidence (the historic homonym admission path)', async () => {
    await prisma.source.create({ data: draft({ key: 'coast', maison: 'Coast', config: { board: 'coast' }, tenantKey: 'ashby:coast' }) });
    await expect(promote('coast')).rejects.toThrow(/employer identity/);
    expect((await prisma.source.findUniqueOrThrow({ where: { key: 'coast' } })).status).toBe('DRAFT');
  });

  it('refuses technical and identity success without a native access decision', async () => {
    await qualifiedDraft(false);
    await expect(promote('test-draft')).rejects.toMatchObject({ name: 'SourceAccessGateError' });
  });

  it('refuses positive operational statistics without a validated native capture', async () => {
    const source = await prisma.source.create({ data: draft({ lastRunJobs: 9999 }) });
    await identity(source);
    await expect(promote('test-draft')).rejects.toMatchObject({ name: 'SourceValidationGateError', code: 'VALIDATION_MISSING' });
  });

  it('refuses a newer explicit access denial after a valid grant', async () => {
    const source = await qualifiedDraft();
    await recordSourceAccessDecision(prisma, { sourceKey: source.key, sourceRevisionId: source.currentRevisionId,
      captureBatchId: null, verdict: 'NOT_AUTHORIZED', scopes: [], robotsCaptureIds: [],
      statement: 'Synthetic reviewer revokes access to this specific source revision.', reviewer: 'test', checkedAt: new Date().toISOString() }, true);
    await expect(promote(source.key)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect((await prisma.source.findUniqueOrThrow({ where: { key: source.key } })).status).toBe('DRAFT');
  });

  it('refuses to promote a RETIRED source', async () => {
    await prisma.source.create({ data: draft({ status: 'RETIRED' }) });
    await expect(promote('test-draft')).rejects.toThrow(/RETIRED/);
  });
});

describe('retireSource marks the catalogue row', () => {
  it('sets status RETIRED so the rotation drops it', async () => {
    await prisma.source.create({
      data: {
        key: 'test-retire',
        maison: 'Test',
        kind: 'lever',
        config: { company: 'test' },
        tier: 'ATS_OFFICIAL',
        tenantKey: 'lever:test',
        status: 'ACTIVE',
      },
    });
    const stats = await retireSource(prisma, 'test-retire');
    expect(stats.sourceKey).toBe('test-retire');
    const row = await prisma.source.findUniqueOrThrow({ where: { key: 'test-retire' } });
    expect(row.status).toBe('RETIRED');
  });
});

describe('tenantKeyOf — clés vendor spécifiques', () => {
  it('distingue deux boards Lever par leur `site`, pas par le domaine vendor partagé', () => {
    const a = tenantKeyOf('lever', '{"site": "ashoka"}', 'jobs.lever.co');
    const b = tenantKeyOf('lever', '{"site": "mulberry"}', 'jobs.lever.co');
    expect(a).toBe('lever:ashoka');
    expect(b).toBe('lever:mulberry');
    expect(a).not.toBe(b);
  });
  it('DigitalRecruiters par domainName, Magnet par siteKey', () => {
    expect(tenantKeyOf('digitalrecruiters', '{"domainName": "careers.zadig.com"}')).toBe('digitalrecruiters:careers.zadig.com');
    expect(tenantKeyOf('magnet', '{"siteKey": "9550007d", "origin": "https://x.com"}')).toBe('magnet:9550007d');
  });
});
