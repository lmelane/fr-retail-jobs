import type { Browser } from 'playwright';
import { assertPublicUrl, isPublicHttpUrl } from './ssrf.js';
import { withHostGate, reportThrottle, reportSuccess } from './hostGate.js';

/**
 * FashionJobs sits behind Cloudflare: plain `fetch` gets HTTP 403 on every path,
 * including robots-allowed pages and the sitemap. A real browser engine gets 200.
 * Everything else in this codebase (ATS APIs, career pages) works over plain HTTP,
 * so browser rendering stays opt-in per call site rather than a global transport.
 */

const navigationTimeoutMs = Number(process.env.BROWSER_TIMEOUT_MS ?? 45_000);
const settleMs = Number(process.env.BROWSER_SETTLE_MS ?? 4_000);

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = import('playwright')
      .then(({ chromium }) => chromium.launch({ headless: true }))
      .catch((error) => {
        browserPromise = null;
        throw new Error(
          `Playwright is required to read Cloudflare-protected pages but could not start: ${
            error instanceof Error ? error.message : String(error)
          }. Run: npx playwright install chromium`,
        );
      });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  const browser = await pending.catch(() => null);
  await browser?.close();
}

/**
 * AWS WAF pose son jeton dans un cookie `aws-waf-token` une fois le challenge
 * JavaScript résolu — mesuré le 2026-09-06 sur careers.pvh.com : ~6 s après
 * la navigation, puis le jeton tient 1 347 requêtes HTTP simples d'affilée.
 * Au-delà de 20 s sans cookie, l'origine n'est pas (ou plus) derrière ce WAF.
 */
const WAF_COOKIE = 'aws-waf-token';
const wafPrimeTimeoutMs = Number(process.env.WAF_PRIME_TIMEOUT_MS ?? 20_000);
const WAF_POLL_MS = 500;

const wafTokens = new Map<string, Promise<string | undefined>>();

/**
 * Ouvre UNE page de l'origine, attend que le challenge WAF soit passé et
 * renvoie l'en-tête `cookie` (`aws-waf-token=…`) à rejouer en HTTP simple —
 * `undefined` si aucun jeton n'apparaît dans le délai. Mémorisé par origine
 * pour la durée du process : un seul amorçage par run et par hôte, même si
 * plusieurs requêtes parallèles le demandent en même temps.
 */
export function primeWafToken(url: string): Promise<string | undefined> {
  const key = new URL(url).origin;
  let pending = wafTokens.get(key);
  if (!pending) {
    pending = primeWafTokenOnce(key, url).catch((error: unknown) => {
      // Un amorçage raté ne doit pas être gravé : la prochaine demande réessaie.
      wafTokens.delete(key);
      throw error;
    });
    wafTokens.set(key, pending);
  }
  return pending;
}

/**
 * Navigue sur l'URL CHALLENGÉE elle-même, pas sur la racine de l'origine :
 * Ralph Lauren ne pose le challenge que sous /en_US/CareersCorporate/… — la
 * racine répond sans jeton, et l'amorçage expirait après 20 s (mesuré
 * 2026-09-06). Le jeton reste mémorisé par origine.
 */
async function primeWafTokenOnce(origin: string, url: string): Promise<string | undefined> {
  assertPublicUrl(url);
  return withHostGate(origin, async () => {
    const browser = await getBrowser();
    // Même profil que fetchRenderedHtml : le jeton est lié à l'empreinte du
    // navigateur qui a résolu le challenge, et les requêtes HTTP qui le
    // rejouent portent un User-Agent desktop de la même famille.
    const context = await browser.newContext({
      locale: 'fr-FR',
      userAgent: BROWSER_USER_AGENT,
      extraHTTPHeaders: { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7' },
    });
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
      if (!isPublicHttpUrl(page.url())) {
        throw new Error(`Refusing WAF priming on non-public URL: ${page.url()}`);
      }
      const deadline = Date.now() + wafPrimeTimeoutMs;
      while (Date.now() < deadline) {
        const token = (await context.cookies(origin)).find((cookie) => cookie.name === WAF_COOKIE);
        if (token) return `${WAF_COOKIE}=${token.value}`;
        await page.waitForTimeout(WAF_POLL_MS);
      }
      return undefined;
    } finally {
      await context.close();
    }
  });
}

/**
 * Fetches fully rendered HTML. Throws on a non-2xx status so a Cloudflare block
 * surfaces as a hard failure instead of being parsed as an empty directory.
 */
export async function fetchRenderedHtml(url: string): Promise<string> {
  // Same SSRF guard as the plain-HTTP path: the browser must not be pointed at
  // an internal target either. Chromium follows redirects itself, so we also
  // check the URL it actually landed on after navigation.
  assertPublicUrl(url);

  // Same per-host politeness as the plain-HTTP path: a shared host (or the 14k
  // discovery run) must not be hammered by parallel page loads.
  return withHostGate(url, async () => {
    const browser = await getBrowser();
    const context = await browser.newContext({
      locale: 'fr-FR',
      userAgent: BROWSER_USER_AGENT,
      extraHTTPHeaders: { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7' },
    });

    try {
      const page = await context.newPage();
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeoutMs,
      });

      // A redirect chain may have landed on an internal host; refuse its content.
      const finalUrl = response?.url() ?? page.url();
      if (!isPublicHttpUrl(finalUrl)) {
        throw new Error(`Refusing rendered content from non-public URL: ${finalUrl}`);
      }

      const status = response?.status();
      if (status === undefined) throw new Error(`No response received for ${url}`);
      if (status < 200 || status >= 300) {
        if ([403, 405, 429, 500, 502, 503, 504].includes(status)) reportThrottle(url);
        throw new Error(`HTTP ${status} for ${url}`);
      }

      reportSuccess(url);
      // Let lazy-rendered list items attach before snapshotting the DOM.
      await page.waitForTimeout(settleMs);
      return await page.content();
    } finally {
      await context.close();
    }
  });
}
