import { createSign } from 'node:crypto';

/**
 * Google Indexing API (decision D22): tell Google the moment an offer page is
 * published or removed, so JobPosting pages get crawled fast and expired ones
 * dropped from the index — instead of waiting for the crawler to find them.
 *
 * Auth is a service-account JWT signed with Node's built-in crypto (no extra
 * dependency): sign a JWT -> exchange it for an access token -> publish URL
 * notifications. The whole thing is a NO-OP without GOOGLE_INDEXING_CREDENTIALS,
 * so nothing runs (and nothing breaks) until the real domain is connected and the
 * service account is provisioned — the code is ready, dormant, and safe.
 *
 * Quota note: the API allows ~200 URLs/day by default. This submits only NEW
 * offers (and removals), not the whole catalogue, and caps each run.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PUBLISH_URL = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const SCOPE = 'https://www.googleapis.com/auth/indexing';
/** Default daily quota is ~200; stay under it per run. */
const MAX_PER_RUN = Number(process.env.GOOGLE_INDEXING_MAX_PER_RUN ?? 180);

type ServiceAccount = { client_email: string; private_key: string };

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Reads the service-account JSON from the env var, or null if not configured. */
function loadCredentials(): ServiceAccount | null {
  const raw = process.env.GOOGLE_INDEXING_CREDENTIALS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    // A JSON-escaped key (\\n) must become real newlines for the PEM parser.
    return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

/** Signs a JWT for the service account and exchanges it for an access token. */
async function getAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${claim}`).sign(sa.private_key);
  const assertion = `${header}.${claim}.${base64url(signature)}`;

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!response.ok) {
      console.error('[indexing] token error', response.status, await response.text().catch(() => ''));
      return null;
    }
    const json = (await response.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch (error) {
    console.error('[indexing] token exception', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** The public site base URL, for building /offre/<id> links to submit. */
function siteBase(): string | null {
  const url = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  return url ? url.replace(/\/$/, '') : null;
}

export type IndexingResult = { submitted: number; failed: number; skipped: boolean };

/**
 * Builds the notification list for a run and submits it: offers created since
 * `since` (URL_UPDATED) and offers closed since `since` (URL_DELETED). No-op when
 * the site URL or the credentials are missing — the domain must be connected
 * first (D22). Reads a lightweight id-only slice from the caller-provided rows.
 */
export async function submitOfferChanges(
  createdIds: string[],
  closedIds: string[],
): Promise<IndexingResult> {
  const base = siteBase();
  if (!base) {
    console.warn('[indexing] SITE_URL/NEXT_PUBLIC_SITE_URL not set — nothing submitted (connect the domain first)');
    return { submitted: 0, failed: 0, skipped: true };
  }
  const urls = [
    ...createdIds.map((id) => ({ url: `${base}/offre/${id}`, type: 'URL_UPDATED' as const })),
    ...closedIds.map((id) => ({ url: `${base}/offre/${id}`, type: 'URL_DELETED' as const })),
  ];
  return submitToGoogleIndex(urls);
}

/**
 * Notifies Google of published (URL_UPDATED) and removed (URL_DELETED) offer
 * URLs. No-op (skipped:true) when credentials are absent. Never throws.
 */
export async function submitToGoogleIndex(
  urls: { url: string; type: 'URL_UPDATED' | 'URL_DELETED' }[],
): Promise<IndexingResult> {
  if (urls.length === 0) return { submitted: 0, failed: 0, skipped: false };

  const sa = loadCredentials();
  if (!sa) {
    console.warn(`[indexing] GOOGLE_INDEXING_CREDENTIALS not set — ${urls.length} URL(s) not submitted`);
    return { submitted: 0, failed: 0, skipped: true };
  }

  const token = await getAccessToken(sa);
  if (!token) return { submitted: 0, failed: urls.length, skipped: false };

  const batch = urls.slice(0, MAX_PER_RUN);
  let submitted = 0;
  let failed = 0;
  for (const { url, type } of batch) {
    try {
      const response = await fetch(PUBLISH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ url, type }),
      });
      if (response.ok) submitted++;
      else {
        failed++;
        if (failed <= 3) console.error(`[indexing] ${type} ${url} -> ${response.status}`);
      }
    } catch {
      failed++;
    }
  }
  console.log(
    `[indexing] ${submitted} submitted, ${failed} failed` +
      (urls.length > batch.length ? ` (${urls.length - batch.length} deferred, daily cap)` : ''),
  );
  return { submitted, failed, skipped: false };
}
