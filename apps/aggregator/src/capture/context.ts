import { AsyncLocalStorage } from 'node:async_hooks';
import { digestBytes } from '../lib/evidenceHash.js';
import { parseCaptureFailure } from '../lib/transportFailure.js';
import { logicalRequestFingerprint, REQUEST_NEGOTIATION_HEADERS, type RequestDescription, type RequestData, type TransportHop } from './requestData.js';

export { digestBytes } from '../lib/evidenceHash.js';
export type CaptureRequest = { url: string; method?: string; body?: RequestInit['body']; headers?: RequestInit['headers']; format: 'HTTP_RESPONSE' | 'BROWSER_RESPONSE' | 'RENDERED_DOM';
  transport?: { origin: 'HTTP_TRANSPORT' | 'BROWSER_TRANSPORT'; hops: TransportHop[] };
  /** Une requête du navigateur d'amorçage WAF autorisé de cette collecte (D-483), jamais un collecteur navigateur. */
  wafBootstrap?: object };
/**
 * L'autorisation d'amorcer un défi WAF pour l'adresse défiée `url` dans cette collecte : le filtre de ce que le
 * navigateur a le droit d'envoyer, ou `null` si la source n'est pas autorisée (le défi n'est alors pas amorcé,
 * sans navigateur). Une autorisation refusée par la décision d'accès lève `SourceAccessGateError`.
 */
export type WafBootstrapPolicy = (url: string) => { allow: (request: { url: string; method: string }) => boolean } | null;
export type CaptureRecord = {
  sequence: number; requestHash: string; requestUrl: string; method: string; format: CaptureRequest['format'];
  status: number | null; headers: Record<string, string>; cookieNames: string[]; complete: boolean;
  failure: string | null; bytes: Uint8Array | null;
  requestData: RequestData;
};
export type ReplayResponse = { bytes: Uint8Array | null; status: number | null; headers: Record<string, string>; cookieNames: string[]; complete: boolean; failure: string | null };
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
  /** D-483 : qui peut amorcer un défi WAF dans cette collecte, et ce que son navigateur peut envoyer. */
  wafBootstrap?: WafBootstrapPolicy;
  /**
   * L'amorçage COURANT de cette collecte — sur une seule origine — et le jeton qu'il a rendu. `target` : l'adresse
   * défiée qu'il a chargée (un renouvellement recharge la même, D-516 §1).
   */
  wafBootstrapRun?: { origin: string; cookie: Promise<string | undefined>; value?: string; target?: string };
  /** Nombre d'amorçages conduits par cette collecte (au plus `MAX_COLLECTION_BOOTSTRAPS`, D-516 §1). */
  wafBootstrapCount?: number;
  /** Une réponse de l'origine amorcée a été acceptée avec un jeton de cette collecte (D-516 §1). */
  wafTokenAccepted?: boolean;
  /** `waf.token_refused` déjà inscrit pour cette collecte (une trace, pas une par fiche refusée). */
  wafRefusalLogged?: boolean;
  /** Rejeu : combien de réponses archivées restent pour cette empreinte de requête (D-516 §1). */
  replayPending?: (hash: string) => number;
  /** Au moins une requête d'amorçage autorisé a été inscrite : la couverture devient `HTTP_WITH_WAF_BOOTSTRAP`. */
  wafBootstrapped?: boolean;
  /** Ce que le journal de cette collecte a inscrit, relu en fin de collecte contre l'autorisation (D-483). */
  wafJournal?: { challenges: { sequence: number; url: string }[]; bootstrap: { sequence: number; url: URL; method: string; userAgent: string | null }[] };
  /** Rejeu : consomme les requêtes d'amorçage inscrites pour cette origine, ou rend `false` si la collecte n'en a pas. */
  replayBootstrap?: (origin: string) => boolean;
};
const contexts = new AsyncLocalStorage<CaptureContext>();
export class OfflineReplayError extends Error {
  constructor(message: string) { super(message); this.name = 'OfflineReplayError'; }
}
/** A recorded failed attempt is data, not a missing/corrupt archive. The normal
 * retry loop must consume the next recorded attempt without live HTTP. It is
 * rethrown under the LIVE error name (adapters may keep that name in their
 * output); a recorded transport cause (`TypeError__UND_ERR_SOCKET`) stays attached. */
export class RecordedTransportError extends Error {
  readonly transportCode?: string;
  constructor(failure: string) {
    super('Recorded transport attempt failed');
    const { name, transportCode } = parseCaptureFailure(failure);
    this.name = name;
    if (transportCode) this.transportCode = transportCode;
  }
}
export class CaptureUnavailableError extends Error {
  constructor(cause: unknown) { super('Native response capture unavailable; extraction stopped', { cause }); this.name = 'CaptureUnavailableError'; }
}
export const withCaptureContext = <T>(context: CaptureContext, work: () => Promise<T>) => contexts.run(context, work);
/** La collecte ou le rejeu en cours, s'il y en a un (l'amorçage WAF y tient son état, D-483). */
export const currentCaptureContext = (): CaptureContext | undefined => contexts.getStore();
/**
 * Stable extraction reference time; native receipts retain their own precise timestamps.
 *
 * DEUX HORODATAGES, DEUX RÔLES — à ne jamais confondre ni faire converger :
 *
 *   `pageEvidence.checkedAt`  → CETTE référence, stable pour tout le lot (`batch.startedAt`).
 *                               Capture et rejeu la reposent à l'identique, donc un même lot
 *                               logique produit les mêmes métadonnées : c'est ce qui rend le
 *                               manifeste rejouable.
 *   `RawCapture.capturedAt`   → l'heure PRÉCISE de réception de chaque réponse native, archivée
 *                               par requête. C'est la seule réponse à « à quelle heure exacte
 *                               cette page a-t-elle été reçue ? ».
 *
 * Un adaptateur ne reconstruit JAMAIS `checkedAt` depuis `capturedAt` : ce serait dupliquer la
 * vérité temporelle dans une seconde couche, au prix d'un couplage au transport et de deux
 * horodatages prétendant à la même preuve à quelques millisecondes près.
 *
 * Mesuré le 2026-09-21 : neuf adaptateurs horodataient leur preuve avec `new Date()`, l'heure du
 * REJEU. Les métadonnées divergeaient donc toujours et la source tombait en
 * `REPLAY_RESULT_CHANGED` — onze sources, 14 706 annonces, alors que la donnée était intacte.
 */
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
    if (record.requestData.origin !== 'HTTP_TRANSPORT') {
      // Une requête du navigateur d'amorçage n'est un transport inscrit que pendant l'amorçage AUTORISÉ de cette
      // collecte (D-483) ; toute autre requête navigateur reste un transport non certifié.
      if (request.wafBootstrap !== undefined && request.wafBootstrap === context.wafBootstrapRun && record.format === 'BROWSER_RESPONSE' &&
        record.requestData.origin === 'BROWSER_TRANSPORT' && record.requestData.hops.length === 1) {
        context.wafBootstrapped = true;
        const hop = record.requestData.hops[0].request;
        (context.wafJournal ??= { challenges: [], bootstrap: [] }).bootstrap.push({ sequence: record.sequence, url: new URL(hop.url), method: hop.method, userAgent: hop.userAgent });
      }
      else noteUnsupportedTransport();
    } else if (record.status === 202 && headers['x-amzn-waf-action'] === 'challenge' && record.requestData.hops.length) {
      (context.wafJournal ??= { challenges: [], bootstrap: [] }).challenges.push({ sequence: record.sequence, url: record.requestData.hops.at(-1)!.request.url });
    }
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
    if (!record.complete || record.status === null || record.bytes === null) {
      if (record.failure) throw new RecordedTransportError(record.failure);
      throw new OfflineReplayError('Incomplete recorded response without a failure reason');
    }
    const headers = new Headers(record.headers);
    for (const name of record.cookieNames) headers.append('set-cookie', `${name}=archive-replay; Path=/`);
    const response = new Response([204, 205, 304].includes(record.status) ? null : Buffer.from(record.bytes),
      { status: record.status, headers });
    Object.defineProperty(response, 'url', { value: request.url });
    return response;
  } catch (cause) {
    if (cause instanceof RecordedTransportError) throw cause;
    const failure = cause instanceof OfflineReplayError ? cause : new OfflineReplayError('Recorded response could not be verified');
    contexts.getStore()!.failure = failure;
    throw failure;
  }
}
