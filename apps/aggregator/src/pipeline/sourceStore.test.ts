import { accessFixture } from '../test/sourceAccessFixture.js';
import { recordSourceAccessDecision } from '../connectors/sourceAccess.js';
import { captureIdentityFixture } from '../test/sourceIdentityFixture.js';
import { recordSourceIdentityReview } from '../connectors/sourceIdentity.js';
import '../test/setup-integration.js';
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { tierFor } from '../connectors/sourceCatalog.js';
import { captureExtraction } from '../capture/batch.js';
import { fetchAtsJobs } from '../ats/index.js';
import { validateCapturedSource } from '../connectors/sourceValidation.js';
import * as certification from '../connectors/sourceCertification.js';
import {
  loadActiveSources,
  promoteSource,
  tenantKeyOf,
} from '../connectors/sourceStore.js';
import { retireSource } from './retireSource.js';

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
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "SourceIngestionAdmission", "SourceIdentityReview"');
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

/**
 * LE SEED CSV A ÉTÉ SUPPRIMÉ — LA GARANTIE QU'IL PORTAIT, NON.
 *
 * `importSourcesCsv` réensemençait la table depuis `data/seeds/sources.csv`. Supprimée le
 * 2026-09-17 : le CSV portait 83 lignes quand la table en portait 536, sans statut, sans
 * révision. Sur une base vide il aurait recréé 83 DRAFT périmées, en conflit de `tenantKey` avec
 * les vraies sources.
 *
 * Les témoins qui vivaient ici gardaient DEUX propriétés, et elles valent toujours — c'est
 * pourquoi ce bloc les reformule au lieu de disparaître avec le CSV :
 *
 *  1. un seed n'active JAMAIS une source : il crée du DRAFT, et la promotion exige une preuve
 *     native datée. `promoteSource` (testé plus bas) porte cette garantie.
 *  2. le catalogue vide doit REFUSER de répondre plutôt que d'ingérer zéro source en silence —
 *     le mode de panne « zéro tranquille » que tout ce chantier existe pour tuer.
 *
 * La seconde est vérifiée ici, sur le message que le nouveau chemin doit nommer.
 */

describe('loadActiveSources', () => {
  it('refuses an empty catalogue instead of silently running zero sources', async () => {
    /*
     * PRÉMISSE — la table doit être vide, sinon `loadActiveSources` répondrait normalement et ce
     * témoin passerait au vert sans exercer le cas dégradé.
     */
    expect(await prisma.source.count()).toBe(0);
    await expect(loadActiveSources(prisma)).rejects.toThrow(/registre/i);
    /*
     * Et il ne doit PLUS renvoyer vers `import-sources` : la commande a été supprimée le
     * 2026-09-17 avec son CSV. Envoyer un opérateur vers une commande inexistante lui coûte une
     * enquête au pire moment — quand le catalogue est vide.
     */
    await expect(loadActiveSources(prisma)).rejects.not.toThrow(/import-sources/);
  });

  it('returns only ACTIVE rows', async () => {
    /*
     * Les lignes sont créées ICI plutôt que semées depuis un CSV supprimé. Le témoin garde la même
     * propriété — une source non ACTIVE n'est jamais servie à la collecte — sans dépendre d'un
     * fichier dont le contenu dérivait de la table qu'il prétendait ensemencer.
     */
    for (const n of [1, 2, 3]) {
      await prisma.source.create({ data: {
        key: `temoin-${n}`, maison: `Témoin ${n}`, kind: 'ashby',
        tenantKey: `ashby:temoin-${n}`, config: { board: `temoin${n}` }, status: 'DRAFT',
        // `tier` vient de la règle métier, pas d'une valeur choisie ici : un palier inventé
        // ferait passer ce témoin sur une source que la déduplication classerait autrement.
        tier: tierFor({ maison: `Témoin ${n}`, kind: 'ashby' } as never),
      } });
    }
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
