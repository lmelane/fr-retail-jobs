import { AsyncLocalStorage } from 'node:async_hooks';
import { digestBytes } from '../lib/evidenceHash.js';
import { logicalRequestFingerprint, REQUEST_NEGOTIATION_HEADERS, type RequestDescription, type RequestData, type TransportHop } from './requestData.js';

export { digestBytes } from '../lib/evidenceHash.js';
export type CaptureRequest = { url: string; method?: string; body?: RequestInit['body']; headers?: RequestInit['headers']; format: 'HTTP_RESPONSE' | 'BROWSER_RESPONSE' | 'RENDERED_DOM';
  transport?: { origin: 'HTTP_TRANSPORT' | 'BROWSER_TRANSPORT'; hops: TransportHop[] } };
export type CaptureRecord = {
  sequence: number; requestHash: string; requestUrl: string; method: string; format: CaptureRequest['format'];
  status: number | null; headers: Record<string, string>; cookieNames: string[]; complete: boolean;
  failure: string | null; bytes: Uint8Array | null;
  requestData: RequestData;
};
type ReplayResponse = { bytes: Uint8Array | null; status: number | null; headers: Record<string, string>; cookieNames: string[]; complete: boolean; failure: string | null };
export type CaptureContext = {
  sequence: number;
  observedAt?: Date;
  /** Evidence-page captures retain redirects; ordinary extraction headers stay unchanged. */
  captureRedirectLocations?: boolean;
  replayWafCookies?: Map<string, string>;
  write?: (record: CaptureRecord) => Promise<void>;
  replay?: (hash: string) => Promise<ReplayResponse>;
  requestAccess?: (request: RequestDescription) => void;
  unsupportedTransport?: boolean;
  accessFailure?: Error;
  failure?: Error;
};
const contexts = new AsyncLocalStorage<CaptureContext>();
export class OfflineReplayError extends Error {
  constructor(message: string) { super(message); this.name = 'OfflineReplayError'; }
}
export class CaptureUnavailableError extends Error {
  constructor(cause: unknown) { super('Native response capture unavailable; extraction stopped', { cause }); this.name = 'CaptureUnavailableError'; }
}
export const withCaptureContext = <T>(context: CaptureContext, work: () => Promise<T>) => contexts.run(context, work);
/** Stable extraction reference time; native receipts retain their own precise timestamps. */
export const captureObservedAt = () => new Date(contexts.getStore()?.observedAt ?? Date.now());
export const capturingResponses = () => Boolean(contexts.getStore()?.write);
export const replayingResponses = () => Boolean(contexts.getStore()?.replay);
/** Replay authentication state is isolated from earlier live requests in the same process. */
export function replayWafCookie(url: string, prime = false): string | undefined {
  const context = contexts.getStore();
  if (!context?.replay) throw new Error('Replay cookie requires an offline capture context');
  context.replayWafCookies ??= new Map();
  const origin = new URL(url).origin;
  if (prime) context.replayWafCookies.set(origin, 'aws-waf-token=archive-replay');
  return context.replayWafCookies.get(origin);
}
export function assertCaptureHealthy() { const context = contexts.getStore(); const error = context?.failure ?? context?.accessFailure; if (error) throw error; }

/** Sticky refusal: an adapter catching a transport error cannot publish a partial result. */
export function assertRequestAccess(request: RequestDescription) {
  const context = contexts.getStore();
  assertCaptureHealthy();
  try { context?.requestAccess?.(request); }
  catch (error) { if (context) context.accessFailure = error as Error; throw error; }
}
export function noteUnsupportedTransport() {
  const context = contexts.getStore();
  if (!context || context.replay) return;
  context.unsupportedTransport = true;
  if (context.requestAccess) {
    context.accessFailure = new CaptureUnavailableError('This access policy certifies only native HTTP requests');
    throw context.accessFailure;
  }
}

/** Preserve location identity, exclude all query values from the displayed audit URL.
 * Exact request matching hashes the original URL/body and negotiation headers. */
export function auditUrl(value: string): string {
  const url = new URL(value);
  url.username = ''; url.password = ''; url.hash = '';
  for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[VALUE OMITTED]');
  return url.toString();
}

export function describeRequest(request: CaptureRequest): RequestDescription {
  let body: Uint8Array | string = '';
  if (typeof request.body === 'string') body = request.body;
  else if (request.body instanceof URLSearchParams) body = request.body.toString();
  else if (request.body instanceof ArrayBuffer) body = new Uint8Array(request.body);
  else if (ArrayBuffer.isView(request.body)) body = new Uint8Array(request.body.buffer, request.body.byteOffset, request.body.byteLength);
  else if (request.body != null) throw new Error('Capture requires a reproducible string or byte request body');
  const headers = new Headers(request.headers);
  const negotiation = Object.fromEntries(REQUEST_NEGOTIATION_HEADERS.map(name => [name, headers.get(name)])) as RequestDescription['negotiation'];
  return { url: request.url, method: request.method?.toUpperCase() ?? 'GET', format: request.format,
    bodyHash: digestBytes(body), userAgent: headers.get('user-agent'), negotiation };
}

export const requestFingerprint = (request: CaptureRequest) => logicalRequestFingerprint(describeRequest(request));

const HEADER_NAMES = ['content-type', 'content-encoding', 'content-language', 'content-length', 'date', 'last-modified', 'etag',
  'retry-after', 'x-wp-total', 'x-wp-totalpages', 'x-amzn-waf-action'] as const;
export async function captureResponse(request: CaptureRequest, response: {
  status?: number; headers?: Headers; bytes: Uint8Array | null; complete: boolean; failure?: string;
}): Promise<void> {
  const context = contexts.getStore();
  if (!context?.write) return;
  // A policy refusal stops further transport and publication, but must not erase
  // receipts for earlier dispatched hops. A failed archive itself remains fatal.
  if (context.failure) throw context.failure;
  try {
    const names = context.captureRedirectLocations ? [...HEADER_NAMES, 'location'] : HEADER_NAMES;
    const headers = Object.fromEntries(names.flatMap(name => {
      const value = response.headers?.get(name);
      return value === null || value === undefined ? [] : [[name, value]];
    }));
    // Names suffice to replay session-dependent pagination. Values are never persisted.
    const cookieNames = [...new Set((response.headers?.getSetCookie?.() ?? []).flatMap(cookie => {
      const name = /^([^=;,\s]+)=/.exec(cookie)?.[1]; return name ? [name] : [];
    }))];
    const record: CaptureRecord = { sequence: context.sequence++, requestHash: requestFingerprint(request),
      requestUrl: auditUrl(request.url), method: request.method?.toUpperCase() ?? 'GET', format: request.format,
      requestData: { version: 1, logical: describeRequest(request),
        origin: request.transport?.hops.length ? request.transport.origin : request.format === 'RENDERED_DOM' ? 'RENDERED_DOM' : 'UNOBSERVED_TRANSPORT',
        hops: request.transport?.hops ?? [] },
      status: response.status ?? null, headers, cookieNames, bytes: response.bytes, complete: response.complete, failure: response.failure ?? null };
    if (record.requestData.origin !== 'HTTP_TRANSPORT') noteUnsupportedTransport();
    await context.write(record);
  } catch (cause) {
    context.failure = new CaptureUnavailableError(cause);
    throw context.failure;
  }
}

/** A replay miss always throws; it must never fall through to a network call. */
export async function replayResponse(request: CaptureRequest): Promise<Response | undefined> {
  const replay = contexts.getStore()?.replay;
  if (!replay) return undefined;
  try {
    const record = await replay(requestFingerprint(request));
    if (!record.complete || record.status === null || record.bytes === null) throw new OfflineReplayError(`Recorded incomplete response: ${record.failure ?? 'unknown'}`);
    const headers = new Headers(record.headers);
    for (const name of record.cookieNames) headers.append('set-cookie', `${name}=archive-replay; Path=/`);
    const response = new Response([204, 205, 304].includes(record.status) ? null : Buffer.from(record.bytes),
      { status: record.status, headers });
    Object.defineProperty(response, 'url', { value: request.url });
    return response;
  } catch (cause) {
    const failure = cause instanceof OfflineReplayError ? cause : new OfflineReplayError('Recorded response could not be verified');
    contexts.getStore()!.failure = failure;
    throw failure;
  }
}
