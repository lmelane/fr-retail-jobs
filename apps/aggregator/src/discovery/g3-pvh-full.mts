import pLimit from 'p-limit';
import { chromium } from 'playwright';
import { fetchWithRetry } from '../lib/http.js';
import { fetchSitemapUrls } from '../connectors/generic/jsonLdSitemap.js';
import { parseJobPostings } from '../ats/adapters/genericJsonLd.js';

/**
 * PVH — mesure complète du chemin « jeton WAF navigateur + HTTP simple » :
 * 1 session Playwright pour obtenir aws-waf-token, puis les 1 347 pages détail
 * du sitemap en HTTP simple (concurrence 4), JSON-LD lu par le parseur du
 * générique. Rejoue exactement ce qu'un adaptateur ferait.
 */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const H = { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };

const t0 = Date.now();
const urls = (await fetchSitemapUrls('https://careers.pvh.com/sitemap.xml')).filter((u) => /\/jobs\/(?!search)/.test(u));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' });
const page = await ctx.newPage();
await page.goto('https://careers.pvh.com/jobs/search', { waitUntil: 'domcontentloaded', timeout: 45_000 });
await page.waitForTimeout(6000);
const cookie = (await ctx.cookies('https://careers.pvh.com')).map((c) => `${c.name}=${c.value}`).join('; ');
await browser.close();

const limit = pLimit(4);
let challenged = 0;
let errors = 0;
const jobs = (
  await Promise.all(
    urls.map((u) =>
      limit(async () => {
        try {
          const r = await fetchWithRetry(u, { headers: { ...H, cookie } });
          if (r.headers.get('x-amzn-waf-action') === 'challenge') challenged += 1;
          return parseJobPostings(await r.text(), u);
        } catch {
          errors += 1;
          return [];
        }
      }),
    ),
  )
).flat();

const withLoc = jobs.filter((k) => k.location || k.city).length;
const withDesc = jobs.filter((k) => (k.description ?? '').length > 200).length;
const withDate = jobs.filter((k) => k.postedAt).length;
console.log(`pvh (jeton WAF + sitemap): ${jobs.length} offres | ${withLoc} lieu | ${withDesc} desc | ${withDate} date | ${Math.round((Date.now() - t0) / 1000)}s ; sitemap ${urls.length} ; challenge ${challenged} ; erreurs ${errors}`);
if (jobs[0]) console.log(`   ex: ${String(jobs[0].title).slice(0, 60)} @ ${jobs[0].location ?? jobs[0].city ?? '-'} — ${jobs[0].url}`);
const countries = new Map<string, number>();
for (const k of jobs) countries.set(k.country ?? '-', (countries.get(k.country ?? '-') ?? 0) + 1);
console.log(`   pays: ${[...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c, n]) => `${c}:${n}`).join(' ')}`);
const companies = new Map<string, number>();
for (const k of jobs) companies.set(k.company ?? '-', (companies.get(k.company ?? '-') ?? 0) + 1);
console.log(`   sociétés: ${[...companies.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, n]) => `${c}:${n}`).join(' ')}`);
const old = jobs.filter((k) => k.postedAt && k.postedAt.getTime() < Date.now() - 365 * 86_400_000).length;
console.log(`   datePosted > 1 an : ${old}`);
