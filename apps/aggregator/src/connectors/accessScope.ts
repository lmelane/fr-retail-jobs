import { isPublicJobSurface, type AccessSurface } from '../lib/accessDecision.js';
import { assertPublicUrl } from '../lib/ssrf.js';
import { CRAWLER_IDENTITY } from '../lib/crawlerIdentity.js';
import type { RequestDescription } from '../capture/requestData.js';

export const SOURCE_ACCESS_POLICY = 'native-http-access/1';
export const SOURCE_ACCESS_MAX_AGE_MS = 30 * 86_400_000;
export class SourceAccessGateError extends Error {
  constructor(readonly code: 'ACCESS_MISSING' | 'ACCESS_DENIED' | 'ACCESS_STALE' | 'ACCESS_INVALID' | 'ACCESS_SCOPE' | 'ACCESS_SUPERSEDED', message: string) {
    super(message); this.name = 'SourceAccessGateError';
  }
}
export const invalidAccess = (message: string): never => { throw new SourceAccessGateError('ACCESS_INVALID', message); };
export type AccessScope = {
  origin: string;
  path: { kind: 'EXACT' | 'PREFIX'; value: string };
  methods: ('GET' | 'HEAD' | 'POST')[];
  query: { fixed: Record<string, string>; variable: string[] };
  surface: AccessSurface;
};
export type AccessDocument = {
  sourceKey: string; sourceRevisionId: string; captureBatchId: string | null;
  verdict: 'ALLOWED' | 'NOT_AUTHORIZED'; scopes: AccessScope[]; robotsCaptureIds: string[];
  statement: string; reviewer: string; checkedAt: string;
};

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function recentAccess(date: Date | string, now: Date): boolean {
  const age = now.getTime() - new Date(date).getTime();
  return Number.isFinite(age) && age >= -300_000 && age <= SOURCE_ACCESS_MAX_AGE_MS;
}
/** Reject path ambiguity before matching a reviewed directory boundary. */
function unambiguousPath(path: string): boolean {
  try {
    return path.startsWith('/') && !/[?#\\\s]/u.test(path) && !/%(?:2f|5c|25)/i.test(path) &&
      path.split('/').every(part => !['.', '..'].includes(decodeURIComponent(part)));
  } catch { return false; }
}
export function parseAccessScopes(value: unknown): AccessScope[] {
  if (!Array.isArray(value) || value.length > 64) return invalidAccess('Access scopes require a bounded explicit list');
  const scopes = value as AccessScope[];
  for (const scope of scopes) {
    if (!exact(scope, ['origin', 'path', 'methods', 'query', 'surface']) ||
      typeof scope.origin !== 'string' || scope.origin.length > 2048 ||
      !exact(scope.path, ['kind', 'value']) || !['EXACT', 'PREFIX'].includes(scope.path.kind) ||
      typeof scope.path.value !== 'string' || scope.path.value.length > 4096 || !unambiguousPath(scope.path.value) ||
      (scope.path.kind === 'PREFIX' && (!scope.path.value.endsWith('/') || scope.path.value === '/')) ||
      !Array.isArray(scope.methods) || !scope.methods.length || scope.methods.length > 3 ||
      new Set(scope.methods).size !== scope.methods.length || scope.methods.some(method => !['GET', 'HEAD', 'POST'].includes(method)) ||
      !isPublicJobSurface(scope.surface) || scope.surface === 'PUBLIC_JS_RENDERED_PAGE' ||
      !exact(scope.query, ['fixed', 'variable']) || !scope.query.fixed || typeof scope.query.fixed !== 'object' || Array.isArray(scope.query.fixed) ||
      !Array.isArray(scope.query.variable) || scope.query.variable.length > 64 || Object.keys(scope.query.fixed).length > 64 ||
      new Set(scope.query.variable).size !== scope.query.variable.length) return invalidAccess('Invalid or unsupported public HTTP access scope');
    const names = [...Object.keys(scope.query.fixed), ...scope.query.variable];
    if (names.some(name => typeof name !== 'string' || !name || name.length > 200 || /[\u0000-\u0020\u007f]/u.test(name)) ||
      scope.query.variable.some(name => Object.hasOwn(scope.query.fixed, name)) ||
      Object.values(scope.query.fixed).some(value => typeof value !== 'string' || value.length > 4096)) return invalidAccess('Invalid access query contract');
    try {
      assertPublicUrl(scope.origin);
      const origin = new URL(scope.origin);
      if (origin.origin !== scope.origin || origin.protocol !== 'https:' || origin.username || origin.password ||
        new URL(scope.path.value, origin).pathname !== scope.path.value) return invalidAccess('Access origins and paths must be exact normalized HTTPS targets');
    } catch { return invalidAccess('Invalid access origin or path'); }
  }
  return scopes;
}

/** Snapshot before asynchronous archive reads; callers cannot change the review mid-flight. */
export function parseAccessDocument(input: unknown, now = new Date()): Readonly<AccessDocument> {
  if (!exact(input, ['sourceKey', 'sourceRevisionId', 'captureBatchId', 'verdict', 'scopes', 'robotsCaptureIds', 'statement', 'reviewer', 'checkedAt'])) return invalidAccess('Explicit access decision document required');
  let text: string;
  try { text = JSON.stringify(input); } catch { return invalidAccess('Access document is not serializable'); }
  if (Buffer.byteLength(text) > 128_000) return invalidAccess('Access document exceeds its byte budget');
  const document = JSON.parse(text) as AccessDocument;
  for (const key of ['sourceKey', 'sourceRevisionId', 'reviewer', 'statement', 'checkedAt'] as const) {
    if (typeof document[key] !== 'string' || !document[key].trim() || document[key].length > (key === 'statement' ? 16000 : 300)) return invalidAccess('Invalid access reviewer or source fields');
  }
  // `checkedAt` est comparé par SQL, converti en timestamptz, à la colonne écrite par Prisma à la milliseconde :
  // une précision supérieure (microsecondes) rendait le dossier « distinct » de lui-même, avec un refus générique
  // (constaté le 2026-09-16 sur oh-my-cream). Le format est donc exigé ici, avec un motif clair.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(document.checkedAt)) return invalidAccess('checkedAt must be an ISO-8601 UTC timestamp (Z) with at most millisecond precision');
  if (!['ALLOWED', 'NOT_AUTHORIZED'].includes(document.verdict) || document.statement.trim().length < 30 || !recentAccess(document.checkedAt, now) ||
    !Array.isArray(document.robotsCaptureIds) || document.robotsCaptureIds.length > 64 ||
    new Set(document.robotsCaptureIds).size !== document.robotsCaptureIds.length ||
    document.robotsCaptureIds.some(id => typeof id !== 'string' || !id || id.length > 300)) return invalidAccess('Invalid access decision or observation references');
  parseAccessScopes(document.scopes);
  if (document.verdict === 'ALLOWED' ?
    typeof document.captureBatchId !== 'string' || !document.captureBatchId || document.captureBatchId.length > 300 || !document.scopes.length || !document.robotsCaptureIds.length :
    document.captureBatchId !== null || document.scopes.length !== 0 || document.robotsCaptureIds.length !== 0) return invalidAccess('A grant requires native evidence; a denial grants no request scope');
  const freeze = (value: object): void => { Object.values(value).forEach(item => { if (item && typeof item === 'object') freeze(item); }); Object.freeze(value); };
  freeze(document); return document;
}

export function matchingAccessScope(scopes: readonly AccessScope[], request: RequestDescription): number {
  const fail = (): never => { throw new SourceAccessGateError('ACCESS_SCOPE', 'Request is outside the reviewed public HTTP scope'); };
  let url: URL;
  try { assertPublicUrl(request.url); url = new URL(request.url); } catch { return fail(); }
  if (request.format !== 'HTTP_RESPONSE' || request.userAgent !== CRAWLER_IDENTITY || url.hash || url.username || url.password ||
    url.protocol !== 'https:' || !unambiguousPath(url.pathname)) return fail();
  const indexes = scopes.flatMap((scope, index) => {
    if (scope.origin !== url.origin || !scope.methods.includes(request.method as 'GET') ||
      !(scope.path.kind === 'EXACT' ? url.pathname === scope.path.value : url.pathname.startsWith(scope.path.value)) ||
      Object.entries(scope.query.fixed).some(([key, value]) => url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value) ||
      [...url.searchParams.keys()].some(key => !Object.hasOwn(scope.query.fixed, key) && !scope.query.variable.includes(key))) return [];
    return [index];
  });
  // Overlaps are review errors; never pick an arbitrary, more permissive scope.
  return indexes.length === 1 ? indexes[0] : fail();
}
