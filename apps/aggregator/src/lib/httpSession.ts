import { AsyncLocalStorage } from 'node:async_hooks';
import { CookieJar } from 'tough-cookie';
import { log } from '../observability/logger.js';

const sessions = new AsyncLocalStorage<CookieJar>();

/** One ephemeral RFC6265 jar per source fetch. Never shared between tenants,
 * runs or parallel sources, and never serialized into diagnostics or RAW. */
export function withHttpSession<T>(work: () => Promise<T>): Promise<T> {
  return sessions.run(new CookieJar(undefined, { prefixSecurity: 'strict' }), work);
}

export async function sessionHeaders(url: string, initial: NonNullable<RequestInit['headers']>): Promise<Headers> {
  const headers = new Headers(initial);
  const jar = sessions.getStore();
  if (!jar) return headers;
  const automatic = await jar.getCookieString(url);
  if (automatic) {
    // Explicit API/WAF cookies take precedence over the same session-cookie
    // name. The underlying redirect guard still strips headers across origins.
    const pairs = new Map<string, string>();
    for (const pair of [automatic, headers.get('cookie') ?? ''].join('; ').split(';')) {
      const i = pair.indexOf('=');
      if (i > 0) pairs.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    headers.set('cookie', [...pairs].map(([key, value]) => `${key}=${value}`).join('; '));
  }
  return headers;
}

export async function rememberSessionCookies(url: string, headers: Headers): Promise<void> {
  const jar = sessions.getStore();
  if (!jar) return;
  for (const cookie of headers.getSetCookie()) {
    try { await jar.setCookie(cookie, url); }
    catch {
      // Invalid public-suffix/domain/prefix cookies are explicitly rejected;
      // neither the rejected value nor its parser exception enters logs.
      await log.warn('http.session_cookie_rejected', { origin: new URL(url).origin, reason: 'RFC6265_COOKIE_REJECTED' });
    }
  }
  if ((await jar.serialize()).cookies.length > 200) throw Error('Source HTTP session exceeded 200 cookies');
}
