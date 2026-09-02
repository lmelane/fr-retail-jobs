import type { Browser } from 'playwright';
import { assertPublicUrl, isPublicHttpUrl } from './ssrf.js';

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
 * Fetches fully rendered HTML. Throws on a non-2xx status so a Cloudflare block
 * surfaces as a hard failure instead of being parsed as an empty directory.
 */
export async function fetchRenderedHtml(url: string): Promise<string> {
  // Same SSRF guard as the plain-HTTP path: the browser must not be pointed at
  // an internal target either. Chromium follows redirects itself, so we also
  // check the URL it actually landed on after navigation.
  assertPublicUrl(url);

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
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status} for ${url}`);

    // Let lazy-rendered list items attach before snapshotting the DOM.
    await page.waitForTimeout(settleMs);
    return await page.content();
  } finally {
    await context.close();
  }
}
