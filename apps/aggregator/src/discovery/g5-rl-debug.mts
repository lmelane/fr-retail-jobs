import { chromium } from 'playwright';
import { fetchText } from '../lib/http.js';

/** g5 — les autres listes du portail Ralph Lauren (Retail, campus) : combien d'offres annoncent-elles ? */
const BASE = 'https://careers.ralphlauren.com/en_US/CareersCorporate';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ userAgent: UA, locale: 'en-US' });
const page = await context.newPage();
await page.goto(`${BASE}/SearchJobsCorporate/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(6000);
const token = (await context.cookies()).find((c) => c.name === 'aws-waf-token')!.value;
await browser.close();
const headers = { 'user-agent': UA, cookie: `aws-waf-token=${token}` };

for (const list of ['SearchJobsCorporate', 'SearchJobsRetail', 'SearchJobsNorthCarolinaCampus']) {
  const html = await fetchText(`${BASE}/${list}/?jobOffset=0&listFilterMode=1`, { headers });
  const declared = html.match(/of\s+(\d+)\s+results/)?.[1];
  const ids = new Set([...html.matchAll(/JobDetail[A-Za-z]*\?jobId=(\d+)/g)].map((m) => m[1]));
  const detailRoute = html.match(/JobDetail[A-Za-z]*\?jobId=/)?.[0];
  console.log(`${list}: annoncé ${declared ?? '?'} résultats | ${ids.size} ids sur la 1re page | route détail ${detailRoute ?? '-'}`);
}
