import { assertPipelineRunning } from './pipelinePause.js';
import type { Browser, BrowserContext, Page, Request as PlaywrightRequest, Response as BrowserResponse } from 'playwright';
import { assertSourceRunning, sourceSignal } from './sourceBudget.js';
import { createPublicBrowserProxy } from './browserProxy.js';
import { assertPublicUrl, isPublicHttpUrl } from './ssrf.js';
import { withHostGate, reportThrottle, reportSuccess } from './hostGate.js';
import { CRAWLER_IDENTITY } from './crawlerIdentity.js';
import { noteUnsupportedTransport, describeRequest, type CaptureRequest, capturingResponses, replayingResponses, captureResponse, replayResponse, CaptureUnavailableError } from '../capture/context.js';
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
 *
 * Exportée sans changement de valeur (D-483) : la preuve d'accès vérifie que chaque requête d'un amorçage WAF
 * inscrit a porté exactement cette identité. Ce n'est pas un réglage.
 */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + `Chrome/126.0.0.0 Safari/537.36 ${CRAWLER_IDENTITY}`;

let browserPromise: Promise<Browser> | null = null;
let proxy: Awaited<ReturnType<typeof createPublicBrowserProxy>> | null = null;

/**
 * Validate before sending each request, including redirects and subresources. `allow` narrows further: a request it
 * refuses is aborted BEFORE leaving the browser (never sent), and remembered in `blocked` so that its
 * `requestfailed` event is not mistaken for a transport attempt.
 */
async function guardContext(context: BrowserContext, allow?: (request: BootstrapRequest) => boolean,
  blocked?: WeakSet<object>, onSent?: (request: PlaywrightRequest) => void): Promise<() => void> {
  const signal = sourceSignal();
  const cancel = () => { void context.close().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    assertSourceRunning();
    // Un WebSocket ne passe pas par `route` (mesuré avec Playwright le 30/09 : la connexion part sans être vue) :
    // sous un amorçage borné, toute ouverture est close avant de joindre un serveur.
    if (allow) await context.routeWebSocket(/.*/, socket => socket.close());
    await context.route('**/*', route => {
      const request = route.request();
      if (signal?.aborted || !isPublicHttpUrl(request.url()) ||
        (allow && !allow({ url: request.url(), method: request.method(), resourceType: request.resourceType() }))) {
        blocked?.add(request);
        return route.abort('blockedbyclient');
      }
      onSent?.(request);
      return route.continue();
    });
  } catch (error) {
    signal?.removeEventListener('abort', cancel);
    await context.close();
    throw error;
  }
  return () => signal?.removeEventListener('abort', cancel);
}

/** `unsupported` : ce navigateur produit-il un transport que le journal ne certifie pas ? Seul l'amorçage observé
 * (D-483), dont chaque requête est inscrite et bornée, répond non. */
async function getBrowser(unsupported = true): Promise<Browser> {
  if (unsupported) noteUnsupportedTransport();
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

/** Une requête que le navigateur d'amorçage s'apprête à envoyer. */
export type BootstrapRequest = { url: string; method: string; resourceType: string };
/**
 * Ce qu'une requête d'amorçage a réellement produit : la réponse (statut, en-têtes, corps borné) ou l'échec de
 * transport. Les en-têtes de REQUÊTE sont ceux que le navigateur a envoyés (identité comprise) ; le cookie qu'ils
 * portent n'est jamais archivé (seules l'identité et la négociation le sont, `describeRequest`).
 */
export type BootstrapObservation = BootstrapRequest & {
  postData: Buffer | null; requestHeaders: Record<string, string> | null;
  status: number | null; responseHeaders: Record<string, string>; body: Buffer | null; failure: string | null;
};
/**
 * Le contrat d'un amorçage PROUVÉ (D-483) : `allow` décide, AVANT l'envoi, de chaque requête que le navigateur
 * soumet à `route` — une requête refusée n'est jamais envoyée. Une redirection, elle, est suivie par le navigateur
 * sans repasser par `route` : la requête redirigée PART ; elle est inscrite si elle survient avant la vidange, et
 * l'amorçage échoue si elle sort des bornes ou si elle survient une fois la vidange commencée (elle ne peut plus
 * être inscrite). `record` reçoit chacune des requêtes parties avant la vidange, attendu avant la fermeture du
 * contexte. Sans observateur, l'amorçage garde son comportement historique (hors collecte).
 */
export type BootstrapObserver = {
  allow(request: BootstrapRequest): boolean;
  record(observation: BootstrapObservation): Promise<void>;
};

/**
 * Ouvre UNE page de l'origine, attend que le challenge WAF soit passé et
 * renvoie l'en-tête `cookie` (`aws-waf-token=…`) à rejouer en HTTP simple —
 * `undefined` si aucun jeton n'apparaît dans le délai. Mémorisé par origine
 * pour la durée du process : un seul amorçage par run et par hôte, même si
 * plusieurs requêtes parallèles le demandent en même temps.
 *
 * Avec un observateur (amorçage dans une collecte, D-483), rien n'est mémorisé ici : la collecte tient son propre
 * jeton, obtenu par un amorçage inscrit dans SON journal, et ne réutilise jamais celui d'une autre.
 */
export function primeWafToken(url: string, observer?: BootstrapObserver): Promise<string | undefined> {
  if (observer) {
    if (replayingResponses()) return Promise.reject(new Error('An observed WAF bootstrap never runs during offline replay'));
    assertPipelineRunning();
    return primeWafTokenOnce(new URL(url).origin, url, observer);
  }
  if (replayingResponses()) return Promise.resolve('aws-waf-token=archive-replay');
  assertPipelineRunning();
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
async function primeWafTokenOnce(origin: string, url: string, observer?: BootstrapObserver): Promise<string | undefined> {
  assertPipelineRunning();
  assertPublicUrl(url);
  if (observer && !observer.allow({ url, method: 'GET', resourceType: 'document' })) {
    throw new Error('WAF bootstrap target is outside its own authorization');
  }
  return withHostGate(origin, async () => {
    // Un amorçage observé est une collecte : il ne démarre pas un navigateur « non supporté » (`getBrowser` le
    // signale), son transport est inscrit requête par requête par l'observateur.
    const browser = await getBrowser(!observer);
    // Même profil que fetchRenderedHtml (identité `BROWSER_USER_AGENT`, D62). Les requêtes HTTP qui rejouent
    // ensuite le jeton portent, elles, l'identité HTTP du collecteur (`CRAWLER_IDENTITY`, lib/http.ts).
    const context = await browser.newContext({
      locale: 'fr-FR',
      userAgent: BROWSER_USER_AGENT,
      extraHTTPHeaders: { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.7' },
      serviceWorkers: 'block',
    });
    const blocked = new WeakSet<object>();
    const sent = new Set<PlaywrightRequest>();
    // Une fois la vidange commencée, `route` refuse tout : une requête tardive ne pourrait plus être inscrite. Une
    // redirection, qui ne passe pas par `route`, est détectée jusqu'après la fermeture et fait échouer l'amorçage.
    let closing = false;
    const releaseGuard = await guardContext(context, observer ? request => !closing && observer.allow(request) : undefined, blocked,
      observer ? request => { sent.add(request); } : undefined);
    const recording = observer ? observeBootstrap(context, observer, blocked, sent) : undefined;
    let token: string | undefined;
    try {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
      if (!isPublicHttpUrl(page.url())) {
        throw new Error(`Refusing WAF priming on non-public URL: ${page.url()}`);
      }
      token = await settledWafToken(context, page, origin);
    } finally {
      // Toute requête partie avant la vidange est inscrite avant la fermeture, y compris celle restée sans réponse :
      // un journal d'amorçage qui ne dirait pas tout ce qui a été envoyé ne prouverait rien (D-483).
      closing = true;
      const failure = await recording?.drain();
      releaseGuard();
      await context.close();
      const late = recording?.finish();
      if (failure ?? late) throw failure ?? late;
    }
    return token;
  });
}

/**
 * Le cookie apparaît AVANT que le challenge soit terminé, puis change de
 * valeur quand le script le finalise. Mesuré le 2026-09-06 sur Ralph
 * Lauren : le premier cookie lu était rejeté (406 sur toutes les
 * tentatives) dans 2 processus sur 3, le troisième avait lu la valeur
 * finale. On renvoie donc la valeur seulement une fois STABLE — inchangée
 * pendant WAF_SETTLE_MS — et le réseau au repos.
 */
async function settledWafToken(context: BrowserContext, page: Page, origin: string): Promise<string | undefined> {
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
}

const withTimeout = <T>(work: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), navigationTimeoutMs); })])
    .finally(() => clearTimeout(timer));
};

/**
 * Inscrit chaque requête partie du navigateur d'amorçage — réponse lue (corps borné) ou échec de transport — auprès
 * de l'observateur. Une requête refusée par `allow` n'est jamais partie : elle n'est pas un transport et n'est pas
 * inscrite. `drain` cesse d'écouter les réponses, attend chaque inscription, inscrit comme échec toute requête partie
 * restée sans issue, et rend la première erreur (archivage, ou requête redirigée hors bornes). L'écoute des requêtes
 * reste active jusqu'à `finish`, appelé APRÈS la fermeture du contexte : toute requête redirigée apparue une fois la
 * vidange commencée — partie sans `route`, jamais inscrite — y rend une erreur qui fait échouer l'amorçage.
 */
function observeBootstrap(context: BrowserContext, observer: BootstrapObserver, blocked: WeakSet<object>, sent: Set<PlaywrightRequest>) {
  const settled = new Set<PlaywrightRequest>();
  const pending = new Set<Promise<void>>();
  let failure: unknown;
  // Une redirection est suivie par le navigateur sans repasser par `route` (mesuré le 30/09) : la requête redirigée
  // est PARTIE. Avant la vidange, elle est inscrite comme toute autre, et si elle sort des bornes l'amorçage échoue ;
  // après le début de la vidange, elle ne peut plus être inscrite : l'amorçage échoue (`finish`).
  const escaped = (request: PlaywrightRequest) => !observer.allow({ url: request.url(), method: request.method(), resourceType: request.resourceType() });
  let draining = false;
  let late: Error | undefined;
  const onRequest = (request: PlaywrightRequest) => {
    if (!request.redirectedFrom()) return;
    if (draining) late ??= new Error('WAF bootstrap redirect sent after the journal was drained');
    else sent.add(request);
  };
  const describe = (request: PlaywrightRequest) => ({ url: request.url(), method: request.method(), resourceType: request.resourceType(),
    postData: request.postDataBuffer() });
  const track = (request: PlaywrightRequest, work: () => Promise<BootstrapObservation>) => {
    if (settled.has(request)) return;
    settled.add(request);
    if (escaped(request)) failure ??= new Error('WAF bootstrap request escaped its authorization (redirect)');
    const task = work().then(observation => observer.record(observation)).catch(error => { failure ??= error; });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  // En HTTP/2, les en-têtes d'une requête (redirigée notamment) portent des pseudo-en-têtes (`:authority`…), qu'aucun
  // `Headers` n'accepte : ils ne décrivent pas l'identité ni la négociation, ils sont écartés.
  const headersOf = (request: PlaywrightRequest) => withTimeout(request.allHeaders(), 'Browser request headers timeout')
    .then(headers => Object.fromEntries(Object.entries(headers).filter(([name]) => !name.startsWith(':'))))
    .catch(() => null);
  const onResponse = (response: BrowserResponse) => {
    const request = response.request();
    track(request, async () => {
      const status = response.status();
      const responseHeaders = response.headers();
      const declared = Number(responseHeaders['content-length']);
      let body: Buffer | null = null;
      let bodyFailure: string | null = null;
      if (status >= 300 && status < 400) bodyFailure = 'RedirectBodyUnavailable';
      else if (Number.isFinite(declared) && declared > MAX_CAPTURE_BYTES) bodyFailure = 'BodySizeLimit';
      else {
        try { body = await withTimeout(response.body(), 'Browser capture body timeout'); }
        catch (error) { bodyFailure = error instanceof Error ? error.name || 'BrowserReadError' : 'BrowserReadError'; }
        if (body && body.byteLength > MAX_CAPTURE_BYTES) { body = null; bodyFailure = 'BodySizeLimit'; }
      }
      return { ...describe(request), requestHeaders: await headersOf(request), status, responseHeaders, body, failure: bodyFailure };
    });
  };
  const onFailed = (request: PlaywrightRequest) => {
    if (blocked.has(request)) return;
    track(request, async () => ({ ...describe(request), requestHeaders: await headersOf(request), status: null, responseHeaders: {},
      body: null, failure: 'BrowserTransportError' }));
  };
  context.on('request', onRequest);
  context.on('response', onResponse);
  context.on('requestfailed', onFailed);
  return {
    async drain(): Promise<unknown> {
      draining = true;
      context.off('response', onResponse);
      context.off('requestfailed', onFailed);
      for (const request of sent) {
        track(request, async () => ({ ...describe(request), requestHeaders: await headersOf(request), status: null, responseHeaders: {},
          body: null, failure: 'ClosedBeforeResponse' }));
      }
      while (pending.size) await Promise.allSettled([...pending]);
      return failure;
    },
    finish(): Error | undefined {
      context.off('request', onRequest);
      return late;
    },
  };
}

/**
 * Fetches fully rendered HTML. Throws on a non-2xx status so a Cloudflare block
 * surfaces as a hard failure instead of being parsed as an empty directory.
 */
export async function fetchRenderedHtml(url: string): Promise<string> {
  const replayed = await replayResponse({ url, format: 'RENDERED_DOM' });
  if (replayed) return replayed.text();
  assertPipelineRunning();
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
