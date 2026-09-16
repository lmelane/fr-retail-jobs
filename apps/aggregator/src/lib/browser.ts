import type { Browser, BrowserContext, Response as BrowserResponse } from 'playwright';
import { assertSourceRunning, sourceSignal } from './sourceBudget.js';
import { createPublicBrowserProxy } from './browserProxy.js';
import { assertPublicUrl, isPublicHttpUrl } from './ssrf.js';
import { withHostGate, reportThrottle, reportSuccess } from './hostGate.js';
import { CRAWLER_IDENTITY } from './crawlerIdentity.js';
import { describeRequest, type CaptureRequest, capturingResponses, replayingResponses, captureResponse, replayResponse, CaptureUnavailableError } from '../capture/context.js';
import { observedHop } from '../capture/requestData.js';
import { MAX_CAPTURE_BYTES } from '../capture/store.js';

/**
 * FashionJobs sits behind Cloudflare: plain `fetch` gets HTTP 403 on every path,
 * including robots-allowed pages and the sitemap. A real browser engine gets 200.
 * Everything else in this codebase (ATS APIs, career pages) works over plain HTTP,
 * so browser rendering stays opt-in per call site rather than a global transport.
 */

const navigationTimeoutMs = Number(process.env.BROWSER_TIMEOUT_MS ?? 45_000);
const settleMs = Number(process.env.BROWSER_SETTLE_MS ?? 4_000);

/**
 * L'identité du collecteur DANS le navigateur automatisé (D62) — elle vaut sur tous les modes de collecte,
 * pas seulement sur le transport HTTP : une identité vraie sur un chemin et absente sur un autre n'en est pas
 * une, et c'est précisément le chemin navigateur qu'un éditeur voit le moins bien.
 *
 * Le préfixe Chrome reste : ces pages exigent un moteur réel et certaines refusent un UA non navigateur — on
 * ne prétend pas ne pas être un navigateur, on ajoute QUI le pilote. Le jeton `CatwalksBot/1.0` et l'URL
 * d'information rendent l'opérateur identifiable et joignable dans les journaux de l'éditeur.
 */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + `Chrome/126.0.0.0 Safari/537.36 ${CRAWLER_IDENTITY}`;

let browserPromise: Promise<Browser> | null = null;
let proxy: Awaited<ReturnType<typeof createPublicBrowserProxy>> | null = null;

/** Validate before sending each request, including redirects and subresources. */
async function guardContext(context: BrowserContext): Promise<() => void> {
  const signal = sourceSignal();
  const cancel = () => { void context.close().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    assertSourceRunning();
    await context.route('**/*', route => {
      if (signal?.aborted || !isPublicHttpUrl(route.request().url())) return route.abort('blockedbyclient');
      return route.continue();
    });
  } catch (error) {
    signal?.removeEventListener('abort', cancel);
    await context.close();
    throw error;
  }
  return () => signal?.removeEventListener('abort', cancel);
}

async function getBrowser(): Promise<Browser> {
  assertSourceRunning();
  if (!browserPromise) {
    browserPromise = import('playwright')
      .then(async ({ chromium }) => {
        proxy = await createPublicBrowserProxy();
        return chromium.launch({ headless: true,
          proxy: { server: proxy.url, bypass: '<-loopback>' },
          args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
        });
      })
      .catch(async (error) => {
        await proxy?.close();
        proxy = null;
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
  try {
    await browser?.close();
  } finally {
    await proxy?.close();
    proxy = null;
  }
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
/** Le cookie doit garder la même valeur aussi longtemps avant d'être cru. */
const WAF_SETTLE_MS = 2_000;

const wafTokens = new Map<string, Promise<string | undefined>>();

/**
 * Ouvre UNE page de l'origine, attend que le challenge WAF soit passé et
 * renvoie l'en-tête `cookie` (`aws-waf-token=…`) à rejouer en HTTP simple —
 * `undefined` si aucun jeton n'apparaît dans le délai. Mémorisé par origine
 * pour la durée du process : un seul amorçage par run et par hôte, même si
 * plusieurs requêtes parallèles le demandent en même temps.
 */
export function primeWafToken(url: string): Promise<string | undefined> {
  if (replayingResponses()) return Promise.resolve('aws-waf-token=archive-replay');
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
      serviceWorkers: 'block',
    });
    const releaseGuard = await guardContext(context);
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
      if (!isPublicHttpUrl(page.url())) {
        throw new Error(`Refusing WAF priming on non-public URL: ${page.url()}`);
      }
      /**
       * Le cookie apparaît AVANT que le challenge soit terminé, puis change de
       * valeur quand le script le finalise. Mesuré le 2026-09-06 sur Ralph
       * Lauren : le premier cookie lu était rejeté (406 sur toutes les
       * tentatives) dans 2 processus sur 3, le troisième avait lu la valeur
       * finale. On renvoie donc la valeur seulement une fois STABLE — inchangée
       * pendant WAF_SETTLE_MS — et le réseau au repos.
       */
      const deadline = Date.now() + wafPrimeTimeoutMs;
      let lastValue: string | undefined;
      let stableSince = 0;
      while (Date.now() < deadline) {
        const token = (await context.cookies(origin)).find((cookie) => cookie.name === WAF_COOKIE);
        if (token) {
          if (token.value !== lastValue) {
            lastValue = token.value;
            stableSince = Date.now();
          } else if (Date.now() - stableSince >= WAF_SETTLE_MS) {
            await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
            const final = (await context.cookies(origin)).find((cookie) => cookie.name === WAF_COOKIE);
            return `${WAF_COOKIE}=${final?.value ?? token.value}`;
          }
        }
        await page.waitForTimeout(WAF_POLL_MS);
      }
      return undefined;
    } finally {
      releaseGuard();
      await context.close();
    }
  });
}

/**
 * Fetches fully rendered HTML. Throws on a non-2xx status so a Cloudflare block
 * surfaces as a hard failure instead of being parsed as an empty directory.
 */
export async function fetchRenderedHtml(url: string): Promise<string> {
  const replayed = await replayResponse({ url, format: 'RENDERED_DOM' });
  if (replayed) return replayed.text();
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
      serviceWorkers: 'block',
    });
    const releaseGuard = await guardContext(context);
    const pending = new Set<Promise<void>>();
    let releaseRecorder: (() => void) | undefined;
    try {
      const page = await context.newPage();
      let captureError: unknown;
      const record = (response: BrowserResponse) => {
        if (!['document', 'xhr', 'fetch'].includes(response.request().resourceType())) return;
        const request: CaptureRequest = { url: response.url(), method: response.request().method(), body: response.request().postDataBuffer(), format: 'BROWSER_RESPONSE' as const };
        const task = (async () => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const headers = new Headers(response.headers());
          let recorded = false;
          try {
            const target = new URL(response.url()); target.hash = '';
            const requestHeaders = await Promise.race([response.request().allHeaders(), new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Browser request headers timeout')), navigationTimeoutMs);
            })]);
            clearTimeout(timer);
            const native = describeRequest({ ...request, url: target.toString(), headers: requestHeaders });
            request.transport = { origin: 'BROWSER_TRANSPORT', hops: [observedHop(native, { status: response.status(), headers })] };
            const declaredLength = Number(headers.get('content-length'));
            if (Number.isFinite(declaredLength) && declaredLength > MAX_CAPTURE_BYTES) throw new Error('Browser body exceeds the bounded size');
            const bytes = await Promise.race([response.body(), new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Browser capture body timeout')), navigationTimeoutMs);
            })]);
            const complete = bytes.byteLength <= MAX_CAPTURE_BYTES;
            await captureResponse(request, { status: response.status(), headers, bytes: bytes.subarray(0, MAX_CAPTURE_BYTES),
              complete, ...(!complete ? { failure: 'BodySizeLimit' } : {}) });
            recorded = true;
            if (!complete) throw new Error('Browser capture exceeds the bounded body size');
          } catch (error) {
            captureError ??= error;
            if (!recorded && !(error instanceof CaptureUnavailableError)) await captureResponse(request,
              { status: response.status(), headers, bytes: null, complete: false, failure: error instanceof Error ? error.name : 'BrowserReadError' });
          } finally { if (timer) clearTimeout(timer); }
        })();
        pending.add(task);
        void task.catch(error => { captureError ??= error; }).finally(() => pending.delete(task));
      };
      if (capturingResponses()) {
        page.on('response', record);
        releaseRecorder = () => page.off('response', record);
      }
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
      const html = await page.content();
      if (capturingResponses()) {
        page.off('response', record);
        await Promise.allSettled([...pending]);
        if (captureError) throw captureError;
        const bytes = Buffer.from(html);
        const complete = bytes.byteLength <= MAX_CAPTURE_BYTES;
        await captureResponse({ url, format: 'RENDERED_DOM' }, { status, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
          bytes: bytes.subarray(0, MAX_CAPTURE_BYTES), complete, ...(!complete ? { failure: 'BodySizeLimit' } : {}) });
        if (!complete) throw new Error('Rendered DOM exceeds the bounded body size');
      }
      return html;
    } finally {
      releaseRecorder?.();
      await Promise.allSettled([...pending]);
      releaseGuard();
      await context.close();
    }
  });
}
