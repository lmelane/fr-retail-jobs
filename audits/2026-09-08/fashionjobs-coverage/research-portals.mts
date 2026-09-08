/** Read-only discovery. Outputs candidates and link evidence, never identity approvals or Source writes. */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { fetchRenderedHtml, closeBrowser } from '../../../apps/aggregator/src/lib/browser.js';
import { fetchWithRetry, readBodyBounded } from '../../../apps/aggregator/src/lib/http.js';
import { detectFromHtml, unadaptedVendorIn } from '../../../apps/aggregator/src/ats/detect.js';
import { isPublicHttpUrl } from '../../../apps/aggregator/src/lib/ssrf.js';
import { withSourceBudget } from '../../../apps/aggregator/src/lib/sourceBudget.js';
import { careerCandidates } from './career-links.mjs';

type Subject = { name: string; directoryUrl: string; directoryOffers: number; urls: string[]; candidateOrigin: string; coverage: string };
const mode = process.argv[2];
if (!['known', 'profiles'].includes(mode)) throw new Error('Use known or profiles');
const privateRoot = 'backups/remediation-20260908';
const evidenceRoot = `${privateRoot}/portal-evidence`;
mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
const output = `${privateRoot}/portal-research-${mode}.jsonl`;
const input: Subject[] = JSON.parse(readFileSync(`${privateRoot}/directory-research-input.json`, 'utf8'));
const completed = new Set<string>(existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line).name) : []);
const subjects = input.filter(row => (mode === 'known' ? row.urls.length > 0 : row.urls.length === 0) && !completed.has(row.name)).sort((a,b) => b.directoryOffers - a.directoryOffers);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const archive = (url: string, html: string) => {
  const sha256 = hash(html);
  writeFileSync(`${evidenceRoot}/${sha256}.html`, html, { mode: 0o600 });
  return { url, at: new Date().toISOString(), sha256 };
};
const safe = (url: string) => { try { return isPublicHttpUrl(url); } catch { return false; } };
const indirectBoard = (url: string) => { try { return /(^|\.)(fashionjobs\.com|fashionnetwork\.com|linkedin\.com|indeed\.[a-z.]+|hellowork\.com|glassdoor\.[a-z.]+|jobijoba\.com)$/.test(new URL(url).hostname); } catch { return true; } };
const sanitize = (raw: string) => {
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(gclid|fbclid|msclkid)$/.test(key)) url.searchParams.delete(key);
  url.hash = '';
  return url.toString();
};
async function page(url: string) {
  if (!safe(url)) throw new Error('Not a public HTTP(S) URL');
  if (indirectBoard(url)) throw new Error('Indirect job board: discovery reference only, no job collection');
  try {
    const response = await fetchWithRetry(url, { signal: AbortSignal.timeout(20000) }, 1);
    const html = await readBodyBounded(response, url);
    if (/just a moment|cf-chl-|captcha/i.test(html.slice(0, 20000))) throw new Error('Browser rendering required');
    return { html, evidence: archive(response.url || url, html), transport: 'HTTP' };
  } catch (httpError) {
    const html = await fetchRenderedHtml(url);
    return { html, evidence: archive(url, html), transport: 'BROWSER', httpFailure: String(httpError).slice(0, 250) };
  }
}
async function inspect(subject: Subject) {
  const result: Record<string, any> = { name: subject.name, directoryUrl: subject.directoryUrl, directoryOffers: subject.directoryOffers, at: new Date().toISOString(), readOnly: true, identityVerdict: 'NOT_AUTOMATICALLY_CERTIFIED', sourceActivated: false, candidateOrigin: subject.candidateOrigin, pages: [], links: [], failures: [] };
  let urls = subject.urls;
  if (!urls.length) {
    if (/^(CONFIDENTIEL|ANONYME)$/i.test(subject.name)) { result.status = 'EMPLOYER_NOT_DISCLOSED'; return result; }
    try {
      const html = await fetchRenderedHtml(subject.directoryUrl);
      const $ = cheerio.load(html);
      urls = [...new Set($('a[href]').map((_, a) => {
        const label = $(a).text().trim(); const href = $(a).attr('href') || '';
        return /site internet|site web|website/i.test(label) && safe(href) ? sanitize(href) : '';
      }).get().filter(Boolean))].slice(0, 2);
      result.candidateOrigin = 'WEBSITE_LINK_FROM_FASHIONJOBS_PROFILE';
      result.declaredWebsites = urls;
      // Company identity metadata only. Do not archive or parse profile job lists,
      // and never navigate to a FashionJobs offer or listing endpoint.
      const metadata = JSON.stringify({ profileUrl: subject.directoryUrl, title: $('title').text(), websites: urls });
      result.profileEvidence = { ...archive(subject.directoryUrl, metadata), scope: 'PROFILE_TITLE_AND_WEBSITE_LINKS_ONLY' };
    } catch (error) { result.failures.push({ url: subject.directoryUrl, error: String(error).slice(0, 300) }); }
  }
  const seen = new Set<string>();
  for (const home of urls) {
    const queue = [{ url: home, depth: 0, from: result.candidateOrigin }];
    while (queue.length && seen.size < 5) {
      const target = queue.shift()!;
      if (seen.has(target.url) || !safe(target.url) || indirectBoard(target.url)) continue;
      seen.add(target.url);
      try {
        const fetched = await page(target.url);
        const $ = cheerio.load(fetched.html);
        const detection = detectFromHtml(fetched.html, target.url);
        const vendor = unadaptedVendorIn(fetched.html);
        result.pages.push({ ...fetched.evidence, transport: fetched.transport, title: $('title').text().slice(0, 160), from: target.from, atsHint: detection && { type: detection.type, careersUrl: detection.careersUrl, config: detection.config }, unsupportedVendorHint: vendor });
        const links = careerCandidates(fetched.html, target.url).map(link=>link.to).filter(safe);
        for (const link of links) result.links.push({ from: target.url, to: link, fromPageHash: fetched.evidence.sha256, directCandidate: !indirectBoard(link) });
        if (target.depth < 1) for (const url of links.filter(link => !indirectBoard(link)).slice(0, 3)) queue.push({ url, depth: target.depth + 1, from: target.url });
      } catch (error) { result.failures.push({ url: target.url, error: String(error).slice(0, 300) }); }
    }
  }
  result.status = result.links.length ? 'CAREER_LINKS_OBSERVED_REVIEW_REQUIRED' : result.pages.some((p: any) => p.atsHint || p.unsupportedVendorHint) ? 'ATS_HINT_REVIEW_REQUIRED' : result.pages.length ? 'NO_CAREER_LINK_FOUND_ON_PAGES_READ' : urls.length ? 'WEBSITE_UNREADABLE' : 'NO_WEBSITE_IN_PROFILE_OR_PROFILE_UNREADABLE';
  return result;
}
const limit = pLimit(3);
let count = 0;
console.log(JSON.stringify({ mode, subjects: subjects.length, alreadyCompleted: completed.size }));
try {
  await Promise.all(subjects.map(subject => limit(async () => {
    let result: Record<string, any>;
    try { result = await withSourceBudget(() => inspect(subject), 90000, subject.name); }
    catch (error) { result = { name: subject.name, at: new Date().toISOString(), readOnly: true, status: 'ERROR', error: String(error).slice(0, 300) }; }
    appendFileSync(output, JSON.stringify(result) + '\n', { mode: 0o600 });
    count++;
    console.log(JSON.stringify({ mode, completed: count, total: subjects.length, name: subject.name, status: result.status, links: result.links?.length ?? 0 }));
  })));
} finally { await closeBrowser(); }
