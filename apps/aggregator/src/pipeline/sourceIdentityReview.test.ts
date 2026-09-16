import '../test/setup-integration.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient, type Prisma, type Source } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { assertIdentityReview, certifiedPortalScope, identityReviewOrder, recordSourceIdentityReview, requireSourceIdentity, sourceIdentityHash, type IdentityReviewDocument } from '../connectors/sourceIdentity.js';
import { readIdentitySource, readIdentitySources } from '../connectors/sourceRegistryRead.js';

import { captureIdentityFixture } from '../test/sourceIdentityFixture.js';
const db = new PrismaClient();
const keys: string[] = [];
const documents = new Map<string, Promise<IdentityReviewDocument>>();
const create = async () => {
  const key = `identity-${randomUUID()}`; keys.push(key);
  return db.source.create({ data: { key, maison: 'Identity witness', kind: 'ashby', config: { board: 'identity-witness' },
    tier: 'EMPLOYER_DIRECT', tenantKey: key, status: 'DRAFT', careersDomain: 'identity-witness.example' } });
};
const document = (s: Source) => {
  if (!documents.has(s.currentRevisionId)) documents.set(s.currentRevisionId, captureIdentityFixture(db, s));
  return documents.get(s.currentRevisionId)!;
};
const latest = (key: string) => db.sourceIdentityReview.findFirstOrThrow({ where: { sourceKey: key }, orderBy: identityReviewOrder });
const record = async (s: Source) => recordSourceIdentityReview(db, await document(s), true);
const rawData = async (s: Source) => {
  await record(s);
  const { id, sequence, createdAt, ...data } = await latest(s.key);
  return { ...data, relationReport: data.relationReport as Prisma.JsonObject };
};
const assertGate = (source: Source) => db.$transaction(tx => requireSourceIdentity(tx, source));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(async () => { await db.$executeRaw`TRUNCATE "SourceIdentityReview"`; });
afterAll(async () => {
  await db.$executeRaw`TRUNCATE "SourceIdentityReview"`;
  await db.source.deleteMany({ where: { key: { in: keys } } });
  await db.$disconnect();
});

describe('identity evidence follows the exact registry revision', () => {
  it('previews without writing, then preserves the artifact and the reviewed revision without activating', async () => {
    const s = await create();
    expect(await recordSourceIdentityReview(db, await document(s))).toMatchObject({ sourceRevisionId: s.currentRevisionId, written: 0 });
    expect(await db.sourceIdentityReview.count()).toBe(0);
    await record(s);
    const review = await latest(s.key);
    expect(review.sourceRevisionId).toBe(s.currentRevisionId);
    expect(review.sequence).toBeGreaterThan(0n);
    expect(review.artifactText).toBe('');
    expect(review.evidenceCaptureBatchId).toBe((await document(s)).captureBatchId);
    expect(review.relationReport).toMatchObject({ verdict: 'LINK_MATCHED', bodyHash: review.artifactHash });
    await assertGate(s);
    expect(await certifiedPortalScope(db, s.key)).toBe('SINGLE_BRAND');
    expect((await db.source.findUniqueOrThrow({ where: { key: s.key } })).status).toBe('DRAFT');
  });

  it('never auto-attaches a dossier without its expected revision', async () => {
    const s = await create();
    await expect(recordSourceIdentityReview(db, { ...await document(s), sourceRevisionId: undefined } as unknown as IdentityReviewDocument, true))
      .rejects.toMatchObject({ name: 'SourceIdentityGateError', code: 'EVIDENCE_INVALID' });
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
    const contradiction = await db.sourceIdentityReview.create({ data: { ...await rawData(s), verdict: 'CONTRADICTED', method: 'ARCHIVED_RESPONSE', portalScope: null,
      createdAt: new Date('2000-01-01'), sequence: -1n } });
    expect(contradiction.sequence).toBeGreaterThan(first.sequence!);
    expect((await latest(s.key)).id).toBe(contradiction.id);
    await expect(assertGate(s)).rejects.toMatchObject({ name: 'SourceIdentityGateError', code: 'REVIEW_MISSING' });
    expect(await certifiedPortalScope(db, s.key)).toBeNull();
  });

  it('allows an explicit contradiction document through the same revision check', async () => {
    const s = await create(); await record(s);
    await recordSourceIdentityReview(db, { ...await document(s), verdict: 'CONTRADICTED', portalScope: null }, true);
    expect((await latest(s.key)).verdict).toBe('CONTRADICTED');
    expect(await certifiedPortalScope(db, s.key)).toBeNull();
  });

  it('does not resurrect a verified dossier retried after a later contradiction', async () => {
    const source = await create(), firstDocument = await document(source);
    await recordSourceIdentityReview(db, firstDocument, true);
    await recordSourceIdentityReview(db, { ...firstDocument, verdict: 'CONTRADICTED', portalScope: null }, true);
    const contradiction = await latest(source.key);
    expect(contradiction.verdict).toBe('CONTRADICTED');
    expect(await recordSourceIdentityReview(db, firstDocument, true)).toMatchObject({ written: 0, isLatestDecision: false });
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
    const s = await create(); const historicalData = await rawData(s);
    await db.$executeRaw`TRUNCATE "SourceIdentityReview"`;
    await db.$transaction(async tx => {
      // Simulate a row retained by the additive migration. This DDL and row are rolled back.
      await tx.$executeRawUnsafe('ALTER TABLE "SourceIdentityReview" DISABLE TRIGGER "SourceIdentityReview_revision_binding"');
      const old = await tx.sourceIdentityReview.create({ data: { ...historicalData, artifactText: 'Historical text stays available', evidenceCaptureBatchId: null, relationReport: undefined, sourceRevisionId: null, sequence: null } });
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
    const transaction = (callback: Parameters<PrismaClient['$transaction']>[0]) => db.$transaction(async tx => {
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
    });
    const instrumented = new Proxy(db, { get(target, key) { return key === '$transaction' ? transaction : Reflect.get(target, key); } });
    await recordSourceIdentityReview(instrumented, await document(source), true);
    expect((await latest(source.key)).sourceRevisionId).toBe(source.currentRevisionId);
  });

  it('assigns sequence after acquiring the source lock, including concurrent direct SQL inserts', async () => {
    const s = await create(); const data = await rawData(s);
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
      return tx.sourceIdentityReview.create({ data });
    }, { timeout: 10000 });
    const waiter = (async () => {
      await canStart;
      return db.$transaction(async tx => {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`; reportPid(pid);
        return tx.sourceIdentityReview.create({ data: { ...data, verdict: 'CONTRADICTED', method: 'ARCHIVED_RESPONSE', portalScope: null, sequence: -100n } });
      }, { timeout: 10000 });
    })();
    const [earlier, later] = await Promise.all([owner, waiter]);
    expect(later.sequence).toBeGreaterThan(earlier.sequence!);
    expect((await latest(s.key)).id).toBe(later.id);
    expect(await certifiedPortalScope(db, s.key)).toBeNull();
  });
});

it('refuses caller-authored artifacts and reports before archive access', async () => {
  const s = await create(), doc = await document(s);
  const archive = vi.spyOn(db.rawBlob, 'findUniqueOrThrow');
  for (const patch of [{ artifactText: 'Forged link' }, { relationReport: { verdict: 'LINK_MATCHED' } }, { artifactHash: 'a'.repeat(64) }]) {
    await expect(recordSourceIdentityReview(db, { ...doc, ...patch }, true)).rejects.toMatchObject({ code: 'EVIDENCE_INVALID' });
  }
  expect(archive).not.toHaveBeenCalled(); expect(await db.sourceIdentityReview.count()).toBe(0);
});
it.each([
  { body: '<p>https://jobs.ashbyhq.com/identity-witness</p>' },
  { body: '<a href="https://jobs.ashbyhq.com/unrelated">Jobs</a>' },
  { status: 403 },
])('never promotes a human VERIFIED verdict without a parsed native relation %j', async options => {
  const s = await create(), doc = await captureIdentityFixture(db, s, options);
  await expect(recordSourceIdentityReview(db, doc, true)).rejects.toMatchObject({ code: 'EVIDENCE_INVALID' });
  expect(await db.sourceIdentityReview.count()).toBe(0);
});
it('can record a contradiction from an archived refusal without granting identity or a perimeter', async () => {
  const s = await create(); await record(s);
  const doc = await captureIdentityFixture(db, s, { status: 403 });
  await recordSourceIdentityReview(db, { ...doc, verdict: 'CONTRADICTED', portalScope: null }, true);
  expect(await latest(s.key)).toMatchObject({ verdict: 'CONTRADICTED', method: 'ARCHIVED_RESPONSE', artifactText: '',
    evidenceCaptureBatchId: doc.captureBatchId, relationReport: { verdict: 'NOT_PROVEN', reason: 'HTTP_RESPONSE_NOT_USABLE' } });
  await expect(assertGate(s)).rejects.toMatchObject({ code: 'REVIEW_MISSING' });
  expect(await certifiedPortalScope(db, s.key)).toBeNull();
});
it('does not attach another source capture or backdate a review before its capture', async () => {
  const s = await create(), other = await create(), doc = await document(s), foreign = await document(other);
  for (const patch of [{ captureBatchId: foreign.captureBatchId }, { checkedAt: new Date(Date.now() - 600_000).toISOString() }]) {
    await expect(recordSourceIdentityReview(db, { ...doc, ...patch }, true)).rejects.toMatchObject({ code: 'EVIDENCE_INVALID' });
  }
  expect(await db.sourceIdentityReview.count()).toBe(0);
});
it('fails on archive I/O before entering the write transaction', async () => {
  const s = await create(), doc = await document(s);
  const transaction = vi.spyOn(db, '$transaction');
  vi.spyOn(db.rawBlob, 'findUniqueOrThrow').mockRejectedValueOnce(new Error('Archive unavailable'));
  await expect(recordSourceIdentityReview(db, doc, true)).rejects.toThrow('Archive unavailable');
  expect(transaction).not.toHaveBeenCalled();
  expect(await db.sourceIdentityReview.count()).toBe(0);
});
it('freezes reviewer input before asynchronous archive I/O and rejects a concurrent revision change', async () => {
  const s = await create(), doc = { ...await document(s) };
  const original = db.rawBlob.findUniqueOrThrow.bind(db.rawBlob);
  let changed = false;
  vi.spyOn(db.rawBlob, 'findUniqueOrThrow').mockImplementation((async (args: Parameters<typeof original>[0]) => {
    if (!changed) {
      changed = true; doc.verdict = 'CONTRADICTED'; doc.portalScope = null;
      // This must succeed during archive reading, before the writer owns a lock.
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout='100ms'");
        await tx.source.update({ where: { key: s.key }, data: { jobUrlPattern: 'changed-during-inspection' } });
      });
    }
    return original(args);
  }) as unknown as typeof db.rawBlob.findUniqueOrThrow);
  await expect(recordSourceIdentityReview(db, doc, true)).rejects.toMatchObject({ code: 'EVIDENCE_INVALID' });
  expect(await db.sourceIdentityReview.count()).toBe(0);
});
it('SQL prevents provenance substitutions even when callers bypass the application writer', async () => {
  const s = await create(), other = await create(), data = await rawData(s), foreign = await document(other);
  const report = data.relationReport as Record<string, unknown>;
  const cases = [
    { evidenceCaptureBatchId: null }, { evidenceCaptureBatchId: foreign.captureBatchId },
    { artifactText: 'Caller-authored replacement' }, { artifactHash: '0'.repeat(64) }, { proofUrl: 'https://foreign.example/' },
    { relationReport: {} }, { relationReport: { ...report, responseId: 'foreign' } },
    { relationReport: { ...report, policy: 'old-policy' } }, { relationReport: { ...report, bodyHash: '0'.repeat(64) } },
    { relationReport: { ...report, verdict: 'NOT_PROVEN' } }, { relationReport: { ...report, witness: {} } },
    { method: 'GROUP_DOCUMENT' }, { checkedAt: new Date(Date.now() - 600_000) },
    { verdict: 'CONTRADICTED', method: 'ARCHIVED_RESPONSE', portalScope: 'SINGLE_BRAND' },
  ];
  for (const patch of cases) {
    await expect(db.sourceIdentityReview.create({ data: { ...data, ...patch } as Parameters<typeof db.sourceIdentityReview.create>[0]['data'] }))
      .rejects.toThrow();
  }
  expect(await db.sourceIdentityReview.count({ where: { sourceKey: s.key } })).toBe(1);
});
it('keeps the original reviewer decision when the caller mutates its object during archive I/O', async () => {
  const s = await create(), doc = { ...await document(s) };
  const original = db.rawBlob.findUniqueOrThrow.bind(db.rawBlob);
  vi.spyOn(db.rawBlob, 'findUniqueOrThrow').mockImplementation((async (args: Parameters<typeof original>[0]) => {
    doc.verdict = 'CONTRADICTED'; doc.portalScope = null; doc.reviewer = 'changed after submission';
    return original(args);
  }) as unknown as typeof db.rawBlob.findUniqueOrThrow);
  await recordSourceIdentityReview(db, doc, true);
  expect(await latest(s.key)).toMatchObject({ verdict: 'VERIFIED', portalScope: 'SINGLE_BRAND', reviewer: 'integration-test' });
});
it('rechecks revision under the write lock after a successful archive inspection', async () => {
  const s = await create(), doc = await document(s);
  const instrumented = new Proxy(db, { get(target, key) {
    if (key !== '$transaction') return Reflect.get(target, key);
    return async (...args: Parameters<typeof db.$transaction>) => {
      await db.source.update({ where: { key: s.key }, data: { jobUrlPattern: 'changed-before-write-lock' } });
      return db.$transaction(...args);
    };
  } });
  await expect(recordSourceIdentityReview(instrumented, doc, true)).rejects.toMatchObject({ code: 'REVISION_MISMATCH' });
  expect(await db.sourceIdentityReview.count()).toBe(0);
});
