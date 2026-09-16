import '../test/setup-integration.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient, type Source } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { assertIdentityReview, certifiedPortalScope, identityReviewOrder, readIdentitySource, readIdentitySources,
  recordSourceIdentityReview, requireSourceIdentity, sourceIdentityHash, sourceSubjectKey,
  type IdentityReviewDocument } from '../connectors/sourceIdentity.js';

const db = new PrismaClient();
const keys: string[] = [];
const artifact = Buffer.from('Official careers: https://job-boards.greenhouse.io/identity-witness');
const create = async () => {
  const key = `identity-${randomUUID()}`; keys.push(key);
  return db.source.create({ data: { key, maison: 'Identity witness', kind: 'greenhouse', config: { board: 'identity-witness' },
    tier: 'EMPLOYER_DIRECT', tenantKey: key, status: 'DRAFT', careersDomain: 'identity-witness.example' } });
};
const document = (s: Source): IdentityReviewDocument => ({
  sourceKey: s.key, sourceRevisionId: s.currentRevisionId, sourceHash: sourceIdentityHash(s), tenantKey: s.tenantKey, subjectKey: sourceSubjectKey(s),
  verdict: 'VERIFIED', method: 'OFFICIAL_LINK', officialDomain: 'identity-witness.example',
  proofUrl: 'https://identity-witness.example/careers', portalUrl: 'https://job-boards.greenhouse.io/identity-witness',
  statement: 'The official employer page explicitly links this exact careers portal.', artifactHash: createHash('sha256').update(artifact).digest('hex'),
  reviewer: 'integration-test', checkedAt: new Date(), portalScope: 'SINGLE_BRAND',
});
const latest = (key: string) => db.sourceIdentityReview.findFirstOrThrow({ where: { sourceKey: key }, orderBy: identityReviewOrder });
const record = (s: Source) => recordSourceIdentityReview(db, document(s), artifact, true);
const rawData = (s: Source) => ({ ...document(s), checkedAt: new Date(), artifactText: artifact.toString() });
const assertGate = (source: Source) => db.$transaction(tx => requireSourceIdentity(tx, source));
beforeEach(async () => { await db.$executeRaw`TRUNCATE "SourceIdentityReview"`; });
afterAll(async () => {
  await db.$executeRaw`TRUNCATE "SourceIdentityReview"`;
  await db.source.deleteMany({ where: { key: { in: keys } } });
  await db.$disconnect();
});

describe('identity evidence follows the exact registry revision', () => {
  it('previews without writing, then preserves the artifact and the reviewed revision without activating', async () => {
    const s = await create();
    expect(await recordSourceIdentityReview(db, document(s), artifact)).toMatchObject({ sourceRevisionId: s.currentRevisionId, written: 0 });
    expect(await db.sourceIdentityReview.count()).toBe(0);
    await record(s);
    const review = await latest(s.key);
    expect(review.sourceRevisionId).toBe(s.currentRevisionId);
    expect(review.sequence).toBeGreaterThan(0n);
    expect(review.artifactText).toBe(artifact.toString());
    await assertGate(s);
    expect(await certifiedPortalScope(db, s.key)).toBe('SINGLE_BRAND');
    expect((await db.source.findUniqueOrThrow({ where: { key: s.key } })).status).toBe('DRAFT');
  });

  it('never auto-attaches a dossier without its expected revision', async () => {
    const s = await create();
    await expect(recordSourceIdentityReview(db, { ...document(s), sourceRevisionId: undefined } as unknown as IdentityReviewDocument, artifact, true))
      .rejects.toMatchObject({ name: 'SourceIdentityGateError', code: 'REVISION_MISMATCH' });
    expect(await db.sourceIdentityReview.count()).toBe(0);
  });

  it.each(['configuration round-trip', 'job URL pattern'])('invalidates old evidence after %s, including unchanged legacy hashes', async change => {
    const s = await create(); await record(s); const old = await latest(s.key);
    if (change === 'configuration round-trip') {
      await db.source.update({ where: { key: s.key }, data: { config: { board: 'different' } } });
      await db.source.update({ where: { key: s.key }, data: { config: s.config! } });
    } else await db.source.update({ where: { key: s.key }, data: { jobUrlPattern: 'https://identity-witness.example/new/{id}' } });
    const current = (await readIdentitySource(db, s.key))!;
    expect(sourceIdentityHash(current)).toBe(sourceIdentityHash(s));
    expect(current.currentRevisionId).not.toBe(s.currentRevisionId);
    await expect(assertGate(current)).rejects.toMatchObject({ name: 'SourceIdentityGateError', code: 'REVISION_MISMATCH' });
    expect(await certifiedPortalScope(db, s.key)).toBeNull();
    await expect(record(s)).rejects.toMatchObject({ name: 'SourceIdentityGateError', code: 'REVISION_MISMATCH' });
    expect(await latest(s.key)).toEqual(old);
    await record(current); await assertGate(current);
    expect(await certifiedPortalScope(db, s.key)).toBe('SINGLE_BRAND');
  });

  it('orders a later contradiction ahead of a verification despite caller clocks and ordinals', async () => {
    const s = await create(); await record(s); const first = await latest(s.key);
    const contradiction = await db.sourceIdentityReview.create({ data: { ...rawData(s), verdict: 'CONTRADICTED',
      createdAt: new Date('2000-01-01'), sequence: -1n } });
    expect(contradiction.sequence).toBeGreaterThan(first.sequence!);
    expect((await latest(s.key)).id).toBe(contradiction.id);
    await expect(assertGate(s)).rejects.toMatchObject({ name: 'SourceIdentityGateError', code: 'REVIEW_MISSING' });
    expect(await certifiedPortalScope(db, s.key)).toBeNull();
  });

  it('allows an explicit contradiction document through the same revision check', async () => {
    const s = await create(); await record(s);
    await recordSourceIdentityReview(db, { ...document(s), verdict: 'CONTRADICTED', portalScope: null }, artifact, true);
    expect((await latest(s.key)).verdict).toBe('CONTRADICTED');
    expect(await certifiedPortalScope(db, s.key)).toBeNull();
  });

  it('does not resurrect a verified dossier retried after a later contradiction', async () => {
    const source = await create(), firstDocument = document(source);
    await recordSourceIdentityReview(db, firstDocument, artifact, true);
    await recordSourceIdentityReview(db, { ...firstDocument, verdict: 'CONTRADICTED' }, artifact, true);
    const contradiction = await latest(source.key);
    expect(contradiction.verdict).toBe('CONTRADICTED');
    expect(await recordSourceIdentityReview(db, firstDocument, artifact, true)).toMatchObject({ written: 0, isLatestDecision: false });
    expect(await db.sourceIdentityReview.count({ where: { sourceKey: source.key } })).toBe(2);
    expect((await latest(source.key)).id).toBe(contradiction.id);
    await expect(assertGate(source)).rejects.toMatchObject({ name: 'SourceIdentityGateError', code: 'REVIEW_MISSING' });
    expect(await certifiedPortalScope(db, source.key)).toBeNull();
  });

  it('reads the same decimal configuration in the profile and the recorded review', async () => {
    const s = await create();
    await db.$executeRaw`UPDATE "Source" SET config='{"board":"identity-witness","threshold":0.12345678912345678}'::jsonb WHERE key=${s.key}`;
    const current = (await readIdentitySource(db, s.key))!;
    expect(current.config).toEqual({ board: 'identity-witness', threshold: 0.12345678912345678 });
    const inventory = (await readIdentitySources(db)).find(item => item.key === s.key)!;
    expect(inventory.config).toEqual(current.config);
    await record(current); await assertGate(current);
    assertIdentityReview(inventory, await latest(s.key));
    expect(await certifiedPortalScope(db, s.key)).toBe('SINGLE_BRAND');
  });

  it('rejects an unbound historical review without replacing its evidence', async () => {
    const s = await create();
    await db.$transaction(async tx => {
      // Simulate a row retained by the additive migration. This DDL and row are rolled back.
      await tx.$executeRawUnsafe('ALTER TABLE "SourceIdentityReview" DISABLE TRIGGER "SourceIdentityReview_revision_binding"');
      const old = await tx.sourceIdentityReview.create({ data: { ...rawData(s), sourceRevisionId: null, sequence: null } });
      expect(() => assertIdentityReview(s, old)).toThrowError(expect.objectContaining({ name: 'SourceIdentityGateError', code: 'ORDER_UNKNOWN' }));
      expect(await certifiedPortalScope(tx, s.key)).toBeNull();
      throw new Error('rollback historical witness');
    }).catch(error => { expect(error.message).toBe('rollback historical witness'); });
    expect(await db.sourceIdentityReview.count()).toBe(0);
  });

  it('SQL refuses missing, foreign and obsolete revision bindings even without the application writer', async () => {
    const s = await create(), foreign = await create(); await record(s); const old = await latest(s.key);
    await db.source.update({ where: { key: s.key }, data: { jobUrlPattern: 'changed' } });
    for (const revisionId of [null, foreign.currentRevisionId, old.sourceRevisionId]) {
      await expect(db.$executeRaw`INSERT INTO "SourceIdentityReview" (id, "sourceKey", "tenantKey", "subjectKey", "sourceHash", verdict, method,
        "officialDomain", "proofUrl", "portalUrl", statement, "artifactHash", reviewer, "checkedAt", "createdAt", "artifactText", "portalScope", "sourceRevisionId", sequence) SELECT
        ${randomUUID()}, "sourceKey", "tenantKey", "subjectKey", "sourceHash", verdict, method, "officialDomain", "proofUrl", "portalUrl", statement,
        "artifactHash", reviewer, "checkedAt", "createdAt", "artifactText", "portalScope", ${revisionId}, null
        FROM "SourceIdentityReview" WHERE id=${old.id}`)
        .rejects.toMatchObject({ code: 'P2010', meta: { code: '23514', message: 'ERROR: Identity review requires the current source revision' } });
    }
    expect(await db.sourceIdentityReview.count()).toBe(1);
  });

  it('preserves the existing SQL immutability of review data, revision and order', async () => {
    const s = await create(); await record(s); const row = await latest(s.key);
    for (const mutation of [
      db.$executeRaw`UPDATE "SourceIdentityReview" SET "sourceRevisionId"=null WHERE id=${row.id}`,
      db.$executeRaw`UPDATE "SourceIdentityReview" SET sequence=-1 WHERE id=${row.id}`,
      db.$executeRaw`DELETE FROM "SourceIdentityReview" WHERE id=${row.id}`,
    ]) await expect(mutation).rejects.toMatchObject({ code: 'P2010', meta: { code: 'P0001' } });
    expect(await latest(s.key)).toEqual(row);
  });

  it('locks the registry before checking and storing the reviewed document', async () => {
    const source = await create();
    const instrumented = { $transaction: (callback: Parameters<PrismaClient['$transaction']>[0]) => db.$transaction(async tx => {
      const wrapped = new Proxy(tx, { get(target, key) {
        if (key !== 'sourceIdentityReview') return Reflect.get(target, key);
        return new Proxy(target.sourceIdentityReview, { get(model, field) {
          if (field !== 'create') return Reflect.get(model, field);
          return async (args: Parameters<typeof model.create>[0]) => {
            await expect(db.$transaction(async other => {
              await other.$executeRawUnsafe("SET LOCAL lock_timeout='100ms'");
              await other.$executeRaw`UPDATE "Source" SET "jobUrlPattern"='concurrent' WHERE key=${source.key}`;
            })).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
            return model.create(args);
          };
        } });
      } });
      return (callback as (tx: typeof wrapped) => Promise<unknown>)(wrapped);
    }) } as unknown as PrismaClient;
    await recordSourceIdentityReview(instrumented, document(source), artifact, true);
    expect((await latest(source.key)).sourceRevisionId).toBe(source.currentRevisionId);
  });

  it('assigns sequence after acquiring the source lock, including concurrent direct SQL inserts', async () => {
    const s = await create();
    let startWaiter!: () => void, reportPid!: (pid: number) => void;
    const canStart = new Promise<void>(r => { startWaiter = r; });
    const waiterPid = new Promise<number>(r => { reportPid = r; });
    const owner = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Source" WHERE key=${s.key} FOR UPDATE`;
      startWaiter(); const pid = await waiterPid;
      const limit = Date.now() + 3000; let blocked = false;
      while (Date.now() < limit) {
        const [state] = await tx.$queryRaw<{ blocked: boolean }[]>`SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS blocked`;
        if (state.blocked) { blocked = true; break; }
        await new Promise(r => setTimeout(r, 10));
      }
      expect(blocked).toBe(true);
      return tx.sourceIdentityReview.create({ data: rawData(s) });
    }, { timeout: 10000 });
    const waiter = (async () => {
      await canStart;
      return db.$transaction(async tx => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; reportPid(pid);
        return tx.sourceIdentityReview.create({ data: { ...rawData(s), verdict: 'CONTRADICTED', sequence: -100n } });
      }, { timeout: 10000 });
    })();
    const [earlier, later] = await Promise.all([owner, waiter]);
    expect(later.sequence).toBeGreaterThan(earlier.sequence!);
    expect((await latest(s.key)).id).toBe(later.id);
    expect(await certifiedPortalScope(db, s.key)).toBeNull();
  });
});
