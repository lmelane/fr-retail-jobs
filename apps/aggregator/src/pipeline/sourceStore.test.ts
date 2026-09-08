import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  importSourcesCsv,
  loadActiveSources,
  promoteSource,
  tenantKeyOf,
} from '../connectors/sourceStore.js';
import { retireSource } from './retireSource.js';
import { sourceIdentityHash, sourceSubjectKey } from '../connectors/sourceIdentity.js';

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
    // 83 rows: the verified catalogue after the tenant consolidation (D-28)
    // removed the 17 duplicate rows that re-fetched the same group feed.
    expect(first.imported).toBe(83);
    expect(first.skippedDuplicateTenant).toEqual([]);

    const again = await importSourcesCsv(prisma);
    expect(again.imported).toBe(0);
    expect(again.updated).toBe(0);
    expect(await prisma.source.count()).toBe(first.imported);

    const rows = await loadActiveSources(prisma);
    expect(rows.length).toBe(0);
    // The CSV has no dated evidence and cannot activate a source.
    const sample = await prisma.source.findFirstOrThrow();
    expect(sample.robotsCheckedAt).toBeNull();
    expect(sample.verifiedJobCount).toBeNull();
    expect(sample.tier).toBeTruthy();
    expect(sample.status).toBe('DRAFT');
  });

  it('preserves operational configuration and real dated evidence on re-import', async () => {
    await importSourcesCsv(prisma);
    const one = await prisma.source.findFirstOrThrow();
    const proof = new Date('2026-09-07T11:12:13Z');
    await prisma.source.update({ where: { id: one.id }, data: {
      status: 'ACTIVE', config: { board: 'corrected-live-board' },
      robotsCheckedAt: proof, robotsVerdict: 'DISALLOWED', verifiedJobCount: 987,
    } });
    await importSourcesCsv(prisma);
    const after = await prisma.source.findUniqueOrThrow({ where: { id: one.id } });
    expect(after.config).toEqual({ board: 'corrected-live-board' });
    expect(after.robotsCheckedAt).toEqual(proof);
    expect(after.robotsVerdict).toBe('DISALLOWED');
    expect(after.verifiedJobCount).toBe(987);
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
  const draft = (over: Record<string, unknown> = {}) => ({
    key: 'test-draft',
    maison: 'Test Maison',
    kind: 'greenhouse',
    config: { board: 'testmaison' },
    tier: 'ATS_OFFICIAL',
    tenantKey: 'greenhouse:testmaison',
    status: 'DRAFT' as const,
    robotsVerdict: 'ALLOWED',
    robotsCheckedAt: new Date(),
    verifiedJobCount: 12,
    ...over,
  });

  it('promotes a proven DRAFT to ACTIVE', async () => {
    const source = await prisma.source.create({ data: draft() });
    const artifactText = 'Official careers: https://job-boards.greenhouse.io/testmaison';
    await prisma.sourceIdentityReview.create({ data: {
      sourceKey: source.key, tenantKey: source.tenantKey, subjectKey: sourceSubjectKey(source), sourceHash: sourceIdentityHash(source),
      verdict: 'VERIFIED', method: 'OFFICIAL_LINK', officialDomain: 'test-maison.example',
      proofUrl: 'https://test-maison.example/careers', portalUrl: 'https://job-boards.greenhouse.io/testmaison',
      statement: 'The official employer careers page links to this exact ATS tenant.', artifactHash: createHash('sha256').update(artifactText).digest('hex'), artifactText, reviewer: 'integration-test', checkedAt: new Date(),
    } });
    const result = await promoteSource(prisma, 'test-draft');
    expect(result).toEqual({ key: 'test-draft', from: 'DRAFT', to: 'ACTIVE' });
    const row = await prisma.source.findUniqueOrThrow({ where: { key: 'test-draft' } });
    expect(row.status).toBe('ACTIVE');
  });

  it('refuses technical success without employer evidence (the historic homonym admission path)', async () => {
    await prisma.source.create({ data: draft({ key: 'coast', maison: 'Coast', config: { board: 'coast' }, tenantKey: 'greenhouse:coast' }) });
    await expect(promoteSource(prisma, 'coast')).rejects.toThrow(/employer identity/);
    expect((await prisma.source.findUniqueOrThrow({ where: { key: 'coast' } })).status).toBe('DRAFT');
  });

  it('refuses without a dated robots verdict', async () => {
    await prisma.source.create({ data: draft({ robotsCheckedAt: null }) });
    await expect(promoteSource(prisma, 'test-draft')).rejects.toThrow(/robots/);
  });

  it('refuses without a proven offer', async () => {
    await prisma.source.create({ data: draft({ verifiedJobCount: 0 }) });
    await expect(promoteSource(prisma, 'test-draft')).rejects.toThrow(/offer/);
  });

  it.each(['DISALLOWED', 'UNKNOWN', 'ERROR'])('refuses a dated %s robots verdict', async verdict => {
    await prisma.source.create({ data: draft({ robotsVerdict: verdict }) });
    await expect(promoteSource(prisma, 'test-draft')).rejects.toThrow(/ALLOWED/);
    expect((await prisma.source.findUniqueOrThrow({ where: { key: 'test-draft' } })).status).toBe('DRAFT');
  });

  it('refuses to promote a RETIRED source', async () => {
    await prisma.source.create({ data: draft({ status: 'RETIRED' }) });
    await expect(promoteSource(prisma, 'test-draft')).rejects.toThrow(/RETIRED/);
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
