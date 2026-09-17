import '../test/setup-integration.js';
import { afterAll, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { persistCapture } from '../capture/store.js';
import { describeRequest, requestFingerprint } from '../capture/context.js';

/**
 * Témoin de l'ordre des verrous du magasin de captures (16/09/2026). Deux captures concurrentes d'un même lot,
 * partageant des octets identiques, s'interbloquaient (40P01) entre le verrou consultatif du blob et la ligne du lot,
 * verrouillée par le déclencheur d'ajout. Le magasin prend désormais la ligne du lot AVANT tout blob : un écrivain
 * qui attend le lot ne détient donc aucun verrou de blob, et deux captures identiques se succèdent sans erreur.
 */
const db = new PrismaClient();
const url = 'https://lock.example.com/jobs';
const logical = describeRequest({ url, headers: { accept: 'application/json' }, format: 'HTTP_RESPONSE' });
const receipt = (sequence: number) => ({ sequence, requestHash: requestFingerprint({ url, headers: { accept: 'application/json' }, format: 'HTTP_RESPONSE' }),
  requestUrl: url, method: 'GET', format: 'HTTP_RESPONSE' as const, status: 200, headers: {}, cookieNames: [],
  requestData: { version: 1 as const, logical, origin: 'UNOBSERVED_TRANSPORT' as const, hops: [] },
  complete: true, failure: null, bytes: Buffer.from('{"jobPostings":[]}') });
afterAll(() => db.$disconnect());

it('takes the batch row before any blob lock, so a writer waiting for the batch holds no advisory lock, and identical captures then succeed', async () => {
  const batch = await db.captureBatch.create({ data: { sourceKey: `lock-${randomUUID()}`, configHash: 'fixture', readerRevision: 'fixture', formatVersion: 2 } });
  let release!: () => void; const released = new Promise<void>(resolve => { release = resolve; });
  let locked!: () => void; const holding = new Promise<void>(resolve => { locked = resolve; });
  const holder = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "CaptureBatch" WHERE id=${batch.id} FOR UPDATE`;
    locked(); await released;
  }, { timeout: 20_000 });
  await holding;
  const writer = persistCapture(db, batch.id, receipt(0));
  // Prémisse : l'écrivain est bien bloqué, et sur la ligne du lot (sa requête courante est le verrou du lot, pas l'insertion).
  let waiting: { pid: number; query: string } | undefined;
  const limit = Date.now() + 5000;
  while (Date.now() < limit && !waiting) {
    const rows = await db.$queryRaw<{ pid: number; query: string }[]>`SELECT pid, query FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid() AND (query ILIKE '%"RawCapture"%' OR query ILIKE '%"CaptureBatch"%')`;
    waiting = rows[0]; if (!waiting) await new Promise(r => setTimeout(r, 25));
  }
  expect(waiting, 'the capture writer must block while the batch row is held').toBeDefined();
  expect(waiting!.query).toMatch(/"CaptureBatch".*FOR UPDATE/s);
  const [{ advisory }] = await db.$queryRaw<{ advisory: bigint }[]>`SELECT count(*)::bigint AS advisory FROM pg_locks WHERE pid=${waiting!.pid} AND locktype='advisory'`;
  expect(Number(advisory)).toBe(0);
  release(); await holder; await writer;
  // Deux captures aux octets identiques (même blob) dans le même lot : la seconde suit la première, sans interblocage.
  await Promise.all([persistCapture(db, batch.id, receipt(1)), persistCapture(db, batch.id, receipt(2))]);
  const rows = await db.rawCapture.findMany({ where: { batchId: batch.id }, orderBy: { sequence: 'asc' }, select: { sequence: true, blobHash: true } });
  expect(rows.map(row => row.sequence)).toEqual([0, 1, 2]);
  expect(new Set(rows.map(row => row.blobHash)).size).toBe(1);
});
