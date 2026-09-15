import '../test/setup-integration.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { captureExtraction, replayExtraction } from '../capture/batch.js';
import { archiveAdapterOutput } from '../capture/observations.js';
import { digestBytes, captureResponse, withCaptureContext } from '../capture/context.js';
import { archiveRawBlob, readRawBlob } from '../capture/store.js';
import { fetchJson, fetchText } from '../lib/http.js';
import { MemoryStore } from '../test/memoryObjectStore.js';
import { upsertDeduplicated } from '../dedup/upsert.js';

const db = new PrismaClient();
const key = () => `capture-${randomUUID()}`;
const url = 'https://capture.example.com/jobs?tenant=fixture';
const payload = '{ "id": "1", "title": "Client Advisor", "unknown": {"locations": ["Paris", "Lyon"]} }\n';
const read = async () => {
  const value = await fetchJson<{ id: string; title: string }>(url);
  return { jobs: [{ externalId: value.id, title: value.title, url, raw: { id: value.id, title: value.title } }] };
};
const latest = (sourceKey: string) => db.captureBatch.findFirstOrThrow({ where: { sourceKey }, include: { captures: true, outcome: true } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => db.$disconnect());

describe('native extraction evidence', () => {
  it('commits exact native bytes before parsing and links the produced publication to its batch', async () => {
    const source = key();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(payload, { headers: { 'content-type': 'application/json',
      'set-cookie': 'JSESSIONID=private-session; Path=/', authorization: 'private-header' } })));
    const result = await captureExtraction(db, source, { tenant: 'fixture' }, undefined, read);
    const batch = await latest(source);
    expect(batch.outcome?.status).toBe('EXTRACTED');
    expect(batch.captures).toHaveLength(1);
    expect((await readRawBlob(db, batch.captures[0].blobHash!)).toString()).toBe(payload);
    expect(batch.captures[0].blobHash).toBe(digestBytes(payload));
    expect(JSON.stringify(batch.captures)).not.toContain('private-session');
    expect(JSON.stringify(batch.captures)).not.toContain('private-header');
    expect(batch.captures[0].cookieNames).toEqual(['JSESSIONID']);
    const candidate = { ...result.jobs[0], company: source, companyId: source, sourceKey: source,
      sourceTier: 'EMPLOYER_DIRECT' as const, atsType: 'GENERIC_JSONLD' as const, country: 'FR', city: 'Paris' };
    const inserted = await upsertDeduplicated(db, candidate);
    expect(await db.jobSource.findFirstOrThrow({ where: { jobId: inserted.jobId } })).toMatchObject({ captureBatchId: batch.id, captureOutputId: result.jobs[0].captureOutputId });
    expect(await db.sourceObservation.findFirstOrThrow({ where: { sourceKey: source } })).toMatchObject({ captureBatchId: batch.id, captureOutputId: result.jobs[0].captureOutputId });
  });

  it('replays the same extraction without calling the network and refuses an unrecorded request', async () => {
    const source = key();
    const network = vi.fn(async () => new Response(payload)); vi.stubGlobal('fetch', network);
    const live = await captureExtraction(db, source, {}, undefined, read);
    const batch = await latest(source);
    network.mockImplementation(async () => { throw new Error('Network must not run during replay'); });
    const replayed = await replayExtraction(db, batch.id, read);
    expect(replayed.jobs).toEqual(live.jobs.map(({ captureBatchId: _batch, captureOutputId: _output, ...job }) => job));
    expect(network).toHaveBeenCalledTimes(1);
    await expect(replayExtraction(db, batch.id, () => fetchJson('https://unrecorded.example.com/jobs'))).rejects.toThrow('absent');
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct job attestations with shared bytes and rejects another job or batch pointer', async () => {
    const source = key(); vi.stubGlobal('fetch', vi.fn(async () => new Response(payload)));
    const first = await captureExtraction(db, source, {}, undefined, read);
    const second = await captureExtraction(db, source, {}, undefined, read);
    const outputs = await db.sourceExtraction.findMany({ where: { batch: { sourceKey: source } } });
    expect(outputs).toHaveLength(2);
    expect(new Set(outputs.map(row => row.outputHash)).size).toBe(1);
    expect(JSON.parse((await readRawBlob(db, outputs[0].outputHash)).toString())).toEqual((await read()).jobs[0]);
    await expect(db.sourceExtraction.update({ where: { id: outputs[0].id }, data: { externalId: 'altered' } })).rejects.toThrow('immutable');
    await expect(archiveAdapterOutput(db, { ...first.jobs[0], sourceKey: source, externalId: 'another-job' })).rejects.toThrow('another captured job');
    await expect(archiveAdapterOutput(db, { ...first.jobs[0], sourceKey: source, captureOutputId: second.jobs[0].captureOutputId })).rejects.toThrow('another captured job');
    await expect(archiveAdapterOutput(db, { ...first.jobs[0], sourceKey: source, raw: { altered: true } })).rejects.toThrow('differs from the captured output');
    await expect(archiveAdapterOutput(db, { ...first.jobs[0], sourceKey: source, url: 'https://example.com/another-application' })).rejects.toThrow('differs from the captured output');
  });

  it('replays observation-dependent holds with the original extraction clock', async () => {
    const { fetchAshbyJobs } = await import('../ats/adapters/ashby.js');
    const source = key(); const config = { board: 'fixture' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ apiVersion: '1', jobs: [
      { id: 'unlisted', title: 'Client Advisor', isListed: false, jobUrl: url },
    ] }))));
    const live = await captureExtraction(db, source, config, undefined, () => fetchAshbyJobs(config));
    const batch = await latest(source);
    await new Promise(resolve => setTimeout(resolve, 5));
    const replay = await replayExtraction(db, batch.id, () => fetchAshbyJobs(config));
    expect(replay.jobs[0].publicationWithdrawnAt).toEqual(live.jobs[0].publicationWithdrawnAt);
  });

  it('isolates replay authentication from live cookies and never primes on the network', async () => {
    const { clearWafTokens, setWafPrimer } = await import('../lib/wafToken.js');
    clearWafTokens(); const prime = vi.fn(async () => 'aws-waf-token=live-private'); setWafPrimer(prime);
    const source = key(); let requests = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ++requests === 1
      ? new Response('', { status: 202, headers: { 'x-amzn-waf-action': 'challenge' } }) : new Response(payload)));
    try {
      await captureExtraction(db, source, {}, undefined, read);
      const batch = await latest(source);
      expect(prime).toHaveBeenCalledTimes(1);
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network forbidden'); }));
      expect((await replayExtraction(db, batch.id, read)).jobs).toHaveLength(1);
      expect(prime).toHaveBeenCalledTimes(1);
    } finally { clearWafTokens(); setWafPrimer(undefined); }
  });

  it('preserves invalid JSON and a failed outcome when parsing crashes', async () => {
    const source = key(); const malformed = '{ "futureNativeField": ["Paris", ';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(malformed)));
    await expect(captureExtraction(db, source, {}, undefined, read)).rejects.toThrow();
    const batch = await latest(source);
    expect(batch.outcome?.status).toBe('FAILED');
    expect(batch.captures).toHaveLength(1);
    expect((await readRawBlob(db, batch.captures[0].blobHash!)).toString()).toBe(malformed);
  });

  it('preserves an actual archived HTML response byte for byte even if the reader returns no jobs', async () => {
    const html = await readFile(new URL('../ats/adapters/fixtures/lot4-generic-globus-p1.html', import.meta.url));
    const source = key(); vi.stubGlobal('fetch', vi.fn(async () => new Response(html)));
    await captureExtraction(db, source, {}, undefined, async () => { await fetchText(url); return { jobs: [] }; });
    const batch = await latest(source);
    expect(await readRawBlob(db, batch.captures[0].blobHash!)).toEqual(html);
    expect(batch.outcome).toMatchObject({ status: 'EXTRACTED', extractedCount: 0 });
  });

  it('retains two attestations of identical bytes while storing one immutable body', async () => {
    const text = JSON.stringify({ unique: key() }); vi.stubGlobal('fetch', vi.fn(async () => new Response(text)));
    const sources = [key(), key()];
    await Promise.all(sources.map(source => captureExtraction(db, source, {}, undefined,
      async () => { await fetchJson(url); return { jobs: [] }; })));
    const captures = await db.rawCapture.findMany({ where: { batch: { sourceKey: { in: sources } } } });
    expect(captures).toHaveLength(2); expect(new Set(captures.map(row => row.blobHash)).size).toBe(1);
    expect(await db.rawBlobBody.count({ where: { hash: digestBytes(text) } })).toBe(1);
    await expect(db.rawCapture.update({ where: { id: captures[0].id }, data: { complete: false } })).rejects.toThrow('immutable');
    await expect(db.rawBlobBody.delete({ where: { hash: digestBytes(text) } })).rejects.toThrow('verified archive');
  });

  it('keeps native bytes and adapter output when the downstream job transaction fails', async () => {
    const source = key(); vi.stubGlobal('fetch', vi.fn(async () => new Response(payload)));
    const result = await captureExtraction(db, source, {}, undefined, read);
    const tx = vi.spyOn(db, '$transaction').mockRejectedValue(new Error('Simulated job transaction failure'));
    await expect(upsertDeduplicated(db, { ...result.jobs[0], company: source, companyId: source,
      sourceKey: source, sourceTier: 'EMPLOYER_DIRECT' })).rejects.toThrow('job transaction failure');
    tx.mockRestore();
    expect(await db.sourceObservation.count({ where: { sourceKey: source } })).toBe(1);
    expect((await latest(source)).captures).toHaveLength(1);
    expect(await db.jobSource.count({ where: { sourceKey: source } })).toBe(0);
  });

  it('stops before parsing when durable capture fails, even if an adapter catches the transport error', async () => {
    const source = key(); const network = vi.fn(async () => new Response(payload)); vi.stubGlobal('fetch', network);
    vi.spyOn(db, '$transaction').mockRejectedValue(new Error('Archive database unavailable'));
    await expect(captureExtraction(db, source, {}, undefined, async () => {
      try { await fetchJson(url); } catch { /* An adapter may hold a failed detail. */ }
      return { jobs: [] };
    })).rejects.toThrow('capture unavailable');
    expect(network).toHaveBeenCalledTimes(1);
    expect((await latest(source)).outcome?.status).toBe('FAILED');
  });

  it('rejects publication if a later capture fails after usable earlier pages were saved', async () => {
    const source = key(); vi.stubGlobal('fetch', vi.fn(async () => new Response(payload)));
    await expect(captureExtraction(db, source, {}, undefined, async () => {
      const result = await read();
      vi.spyOn(db, '$transaction').mockRejectedValueOnce(new Error('Temporary archive outage'));
      try { await fetchJson(url); } catch { /* Reader can otherwise keep earlier jobs. */ }
      return result;
    })).rejects.toThrow('capture unavailable');
    const batch = await latest(source);
    expect(batch.captures).toHaveLength(1); expect(batch.outcome?.status).toBe('FAILED');
    expect(await db.sourceExtraction.count({ where: { batchId: batch.id } })).toBe(0);
  });

  it('records the exact prefix of an interrupted response and never replays it as a complete entity', async () => {
    const source = key();
    const prefix = Buffer.from('{"partial":"');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(prefix); }, pull(controller) { controller.error(new Error('Socket disconnected')); },
    }))));
    await expect(captureExtraction(db, source, {}, undefined, read)).rejects.toThrow();
    const batch = await latest(source);
    expect(batch.captures.length).toBeGreaterThan(0);
    for (const capture of batch.captures) {
      expect(capture.complete).toBe(false);
      expect(await readRawBlob(db, capture.blobHash!)).toEqual(prefix);
    }
    await expect(replayExtraction(db, batch.id, read)).rejects.toThrow('incomplete');
  });

  it('removes hot bytes only after a verified remote read, and can replay from the archive', async () => {
    const source = key(); const text = JSON.stringify({ unique: key() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(text)));
    await captureExtraction(db, source, {}, undefined, async () => { await fetchJson(url); return { jobs: [] }; });
    const batch = await latest(source); const hash = batch.captures[0].blobHash!; const store = new MemoryStore();
    const corrupt = vi.spyOn(store, 'get').mockResolvedValue(Buffer.from('corrupted remote object'));
    await expect(archiveRawBlob(db, hash, store)).rejects.toThrow('verification failed');
    expect(await db.rawBlobBody.count({ where: { hash } })).toBe(1);
    expect(await db.rawBlobArchive.count({ where: { hash } })).toBe(0);
    corrupt.mockRestore();
    expect(await archiveRawBlob(db, hash, store)).toEqual({ purged: true });
    expect(await archiveRawBlob(db, hash, store)).toEqual({ purged: false });
    expect(await readRawBlob(db, hash, store)).toEqual(Buffer.from(text));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Offline only'); }));
    expect(await replayExtraction(db, batch.id, () => fetchJson(url), store)).toEqual(JSON.parse(text));
    vi.spyOn(store, 'get').mockResolvedValue(Buffer.from('later corruption'));
    await expect(readRawBlob(db, hash, store)).rejects.toThrow('integrity mismatch');
  });

  it('does not archive cookie values, Authorization or request bodies in metadata', async () => {
    const records: unknown[] = [];
    await withCaptureContext({ sequence: 0, write: async record => { records.push(record); } }, async () => {
      await captureResponse({ url: 'https://metadata.example.com/list?api_key=secret-api-key', method: 'POST',
        body: 'secret-request-body', format: 'HTTP_RESPONSE' }, { status: 200, complete: true,
        headers: new Headers({ authorization: 'secret-bearer', 'set-cookie': 'session=secret-cookie' }), bytes: Buffer.from('{}') });
    });
    const serialized = JSON.stringify(records);
    for (const secret of ['secret-api-key', 'secret-request-body', 'secret-bearer', 'secret-cookie']) expect(serialized).not.toContain(secret);
  });
});
