import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { Agent } from 'undici';
import { ingestionIssue } from './ingestionIssue.js';
import { briefError } from './normalize.js';
import { BlockedUrlError } from './ssrf.js';
import { IncompleteBodyError } from './http.js';
import { captureFailureLabel, parseCaptureFailure, transportFailureCode } from './transportFailure.js';
import { RecordedTransportError } from '../capture/context.js';

/**
 * D-453, RUN du 24/09/2026 (35ba463f) : Rolex et Ralph Lauren classées INTERNAL/TypeError alors que
 * `source.failed` portait la cause undici. Les deux formes ci-dessous recopient ces événements.
 */
const rolex = () => new TypeError('fetch failed', { cause: Object.assign(
  new Error('Connect Timeout Error (attempted address: www.carrieres-rolex.com:443, timeout: 12000ms)'),
  { name: 'ConnectTimeoutError', code: 'UND_ERR_CONNECT_TIMEOUT' }) });
const ralphLauren = () => new TypeError('fetch failed', { cause: Object.assign(
  new Error('unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca'),
  { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) });

/** A real rejection from the fetch implementation, never a hand-made imitation. */
async function realFetchFailure(url: string, dispatcher?: Agent): Promise<unknown> {
  try { await fetch(url, (dispatcher ? { dispatcher } : {}) as RequestInit); } catch (error) { return error; }
  throw new Error('The witness request unexpectedly succeeded');
}
const closedPort = () => new Promise<number>(resolve => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const { port } = server.address() as { port: number };
    server.close(() => resolve(port));
  });
});

describe('transport failures are UNKNOWN, named by their cause (D-453)', () => {
  it('reclassifies the two production transport failures of the 24/09 RUN', () => {
    for (const [error, code] of [[rolex(), 'TRANSPORT_UND_ERR_CONNECT_TIMEOUT'], [ralphLauren(), 'TRANSPORT_UNABLE_TO_VERIFY_LEAF_SIGNATURE']] as const) {
      // Premise: the production error IS a TypeError — the old rule classified it INTERNAL on its class alone.
      expect(error).toBeInstanceOf(TypeError);
      expect(ingestionIssue(error)).toEqual({ origin: 'UNKNOWN', code, count: 1 });
    }
  });

  it('reads the cause of a real refused connection', async () => {
    const error = await realFetchFailure(`http://127.0.0.1:${await closedPort()}/jobs`);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('fetch failed');
    expect(transportFailureCode(error)).toBe('ECONNREFUSED');
    expect(ingestionIssue(error)).toMatchObject({ origin: 'UNKNOWN', code: 'TRANSPORT_ECONNREFUSED' });
  });

  it('keeps our own defect INTERNAL even when fetch wraps it as a transport failure', async () => {
    const port = await closedPort();
    const bug = await realFetchFailure(`http://localhost:${port}/`, new Agent({ connect: { lookup: () => { throw new TypeError('lookup is broken'); } } }));
    expect(bug).toMatchObject({ message: 'fetch failed', cause: { name: 'TypeError' } });
    expect(ingestionIssue(bug)).toMatchObject({ origin: 'INTERNAL', code: 'TypeError' });
    // Misusing the client, or a Node argument check inside the dispatcher, is still our code.
    expect(ingestionIssue(new TypeError('fetch failed', { cause: Object.assign(new Error('invalid'), { code: 'UND_ERR_INVALID_ARG' }) })).origin).toBe('INTERNAL');
    expect(ingestionIssue(new TypeError('fetch failed', { cause: Object.assign(new TypeError('Invalid URL'), { code: 'ERR_INVALID_URL' }) })).origin).toBe('INTERNAL');
    for (const error of [new TypeError('Cannot read properties of undefined'), new ReferenceError('x is not defined'), new RangeError('Invalid array length')])
      expect(ingestionIssue(error)).toMatchObject({ origin: 'INTERNAL', code: error.name });
  });

  it('keeps an SSRF refusal of the DNS answer a named refusal, not a transport failure', async () => {
    const refused = await realFetchFailure(`http://localhost:${await closedPort()}/`,
      new Agent({ connect: { lookup: (_host, _options, callback) => callback(new BlockedUrlError('DNS:localhost'), []) } }));
    expect(refused).toMatchObject({ message: 'fetch failed', cause: { name: 'BlockedUrlError' } });
    expect(ingestionIssue(refused)).toEqual({ origin: 'UNKNOWN', code: 'BlockedUrlError', count: 1 });
  });

  it('names a body cut by the network by its socket cause', () => {
    const cut = new IncompleteBodyError(new TypeError('terminated', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) }), Buffer.alloc(0));
    expect(ingestionIssue(cut)).toMatchObject({ origin: 'UNKNOWN', code: 'TRANSPORT_UND_ERR_SOCKET' });
    // A read timeout of our own reader carries no transport code and keeps its class.
    expect(ingestionIssue(new IncompleteBodyError(new Error('body read timeout (30000ms)'), Buffer.alloc(0))).code).toBe('IncompleteBodyError');
  });
});

describe('the cause survives in the capture row and the SourceRun note', () => {
  it('keeps the cause code in the bounded note', () => {
    expect(briefError(rolex())).toBe('fetch failed [UND_ERR_CONNECT_TIMEOUT]');
    expect(briefError(ralphLauren())).toBe('fetch failed [UNABLE_TO_VERIFY_LEAF_SIGNATURE]');
    expect(briefError(new Error('Teamtailor origin missing'))).toBe('Teamtailor origin missing');
  });

  it('records the live name first so an offline replay rethrows exactly that name', () => {
    const live = rolex();
    const label = captureFailureLabel(live, 'NetworkError');
    expect(label).toBe('TypeError__UND_ERR_CONNECT_TIMEOUT');
    // Stored hop failures must stay within the sealed request envelope grammar.
    expect(label).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,127}$/);
    const replayed = new RecordedTransportError(label);
    expect(replayed.name).toBe(live.name);
    expect(transportFailureCode(replayed)).toBeNull();
    expect(parseCaptureFailure(label)).toEqual({ name: 'TypeError', transportCode: 'UND_ERR_CONNECT_TIMEOUT' });
    expect(ingestionIssue(replayed)).toMatchObject({ origin: 'UNKNOWN', code: 'TRANSPORT_UND_ERR_CONNECT_TIMEOUT' });
    // Historical labels and non-transport failures replay unchanged.
    expect(new RecordedTransportError('TypeError').name).toBe('TypeError');
    expect(captureFailureLabel(new DOMException('Native request timed out', 'AbortError'), 'NetworkError')).toBe('AbortError');
    expect(captureFailureLabel('not an error', 'NetworkError')).toBe('NetworkError');
  });
});
