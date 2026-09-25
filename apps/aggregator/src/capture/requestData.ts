import { digestBytes } from '../lib/evidenceHash.js';
import { captureFailureLabel } from '../lib/transportFailure.js';

export const REQUEST_DATA_MAX_BYTES = 512_000;
export const REQUEST_NEGOTIATION_HEADERS = ['accept', 'accept-language', 'content-type'] as const;
export type RequestDescription = {
  url: string; method: string; format: 'HTTP_RESPONSE' | 'BROWSER_RESPONSE' | 'RENDERED_DOM';
  bodyHash: string; userAgent: string | null;
  negotiation: Record<typeof REQUEST_NEGOTIATION_HEADERS[number], string | null>;
};
export type TransportHop = {
  request: RequestDescription; status: number | null;
  responseHeaders: Record<string, string>; failure: string | null;
};
export type RequestData = {
  version: 1; logical: RequestDescription;
  origin: 'HTTP_TRANSPORT' | 'BROWSER_TRANSPORT' | 'RENDERED_DOM' | 'UNOBSERVED_TRANSPORT';
  hops: TransportHop[];
};

/** The historical collector key deliberately differs from physical HTTP provenance. */
export function logicalRequestFingerprint(request: RequestDescription): string {
  return digestBytes(JSON.stringify([request.format, request.method, request.url, request.bodyHash,
    REQUEST_NEGOTIATION_HEADERS.map(name => [name, request.negotiation[name]])]));
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
const headerValue = (value: unknown) => value === null || typeof value === 'string' && value.length <= 16_384 && !/[\r\n\0]/.test(value);
const FORMATS = ['HTTP_RESPONSE', 'BROWSER_RESPONSE', 'RENDERED_DOM'];
function description(value: unknown): value is RequestDescription {
  if (!object(value) || !keys(value, ['url', 'method', 'format', 'bodyHash', 'userAgent', 'negotiation']) ||
    typeof value.url !== 'string' || value.url.length > 65_536 || typeof value.method !== 'string' || !/^[A-Z_-]{1,32}$/.test(value.method) ||
    !FORMATS.includes(String(value.format)) || typeof value.bodyHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.bodyHash) ||
    !headerValue(value.userAgent) || !object(value.negotiation) || !keys(value.negotiation, [...REQUEST_NEGOTIATION_HEADERS]) ||
    !Object.values(value.negotiation).every(headerValue)) return false;
  try { const url = new URL(value.url); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
const RESPONSE_HEADERS = ['content-type', 'location', 'retry-after'] as const;
export function observedHop(request: RequestDescription, response: Pick<Response, 'status' | 'headers'> | null, failure?: unknown): TransportHop {
  return { request, status: response?.status ?? null, responseHeaders: Object.fromEntries(RESPONSE_HEADERS.flatMap(name => {
    const value = response?.headers.get(name); return value == null ? [] : [[name, value]];
  })), failure: failure == null ? null : captureFailureLabel(failure, 'TransportError') };
}
const targetUrl = (value: string) => { const url = new URL(value); url.hash = ''; return url.toString(); };

/** Strict private envelope. Full query values never belong in a public report. */
export function validateRequestData(value: unknown): asserts value is RequestData {
  if (!object(value) || !keys(value, ['version', 'logical', 'origin', 'hops']) || value.version !== 1 || !description(value.logical) ||
    !['HTTP_TRANSPORT', 'BROWSER_TRANSPORT', 'RENDERED_DOM', 'UNOBSERVED_TRANSPORT'].includes(String(value.origin)) ||
    !Array.isArray(value.hops) || value.hops.length > 6) throw new Error('Invalid native request envelope');
  const transport = value.origin === 'HTTP_TRANSPORT' || value.origin === 'BROWSER_TRANSPORT';
  if (transport !== (value.hops.length > 0) || value.origin === 'RENDERED_DOM' && value.logical.format !== 'RENDERED_DOM') throw new Error('Invalid native request origin');
  if ((value.origin === 'RENDERED_DOM') !== (value.logical.format === 'RENDERED_DOM')) throw new Error('Derived document requires its own origin');
  if (transport && value.logical.format !== (value.origin === 'HTTP_TRANSPORT' ? 'HTTP_RESPONSE' : 'BROWSER_RESPONSE')) throw new Error('Native request format differs');
  for (const [index, hop] of value.hops.entries()) {
    if (!object(hop) || !keys(hop, ['request', 'status', 'responseHeaders', 'failure']) || !description(hop.request) ||
      hop.request.format !== (value.origin === 'HTTP_TRANSPORT' ? 'HTTP_RESPONSE' : 'BROWSER_RESPONSE') ||
      !(hop.status === null || Number.isInteger(hop.status) && Number(hop.status) >= 100 && Number(hop.status) <= 599) ||
      !(hop.failure === null || typeof hop.failure === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(hop.failure)) ||
      !object(hop.responseHeaders) || Object.keys(hop.responseHeaders).some(name => !(RESPONSE_HEADERS as readonly string[]).includes(name)) ||
      !Object.values(hop.responseHeaders).every(v => typeof v === 'string' && headerValue(v))) throw new Error('Invalid native HTTP hop');
    if ((hop.status === null) !== (hop.failure !== null)) throw new Error('Native HTTP outcome differs');
    if (hop.request.url !== targetUrl(hop.request.url)) throw new Error('Native HTTP target must be serialized without a fragment');
    if (index === 0 && (hop.request.url !== targetUrl(value.logical.url) || hop.request.method !== value.logical.method || hop.request.bodyHash !== value.logical.bodyHash)) throw new Error('Native request starts at another target');
    if (index > 0) {
      const previous = value.hops[index - 1] as TransportHop;
      const location = previous.responseHeaders.location;
      if (previous.status === null || previous.status < 300 || previous.status >= 400 || !location ||
        hop.request.url !== targetUrl(new URL(location, previous.request.url).toString())) throw new Error('Native request redirect chain differs');
      const changesToGet = previous.status === 303 && previous.request.method !== 'HEAD' || [301, 302].includes(previous.status) && previous.request.method === 'POST';
      if (hop.request.method !== (changesToGet ? 'GET' : previous.request.method) ||
        hop.request.bodyHash !== (changesToGet ? digestBytes('') : previous.request.bodyHash)) throw new Error('Native redirected request method/body differs');
    }
  }
  if (Buffer.byteLength(JSON.stringify(value)) > REQUEST_DATA_MAX_BYTES) throw new Error('Native request envelope exceeds its byte budget');
}
