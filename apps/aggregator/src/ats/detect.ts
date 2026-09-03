import * as cheerio from 'cheerio';
import type { AtsType } from '@prisma/client';
import { fetchText } from '../lib/http.js';
import { canonicalCompanyKey } from '../lib/normalize.js';
import { isSearchConfigured, searchWeb } from '../discovery/serper.js';
import { probeAtsBySlug } from '../discovery/atsProbe.js';
import type { AtsDetection } from '../types.js';

const ATS_HOSTS = [
  'greenhouse.io', 'lever.co', 'smartrecruiters.com', 'recruitee.com', 'personio.de',
  'personio.com', 'myworkdayjobs.com', 'teamtailor.com', 'workable.com', 'successfactors.com'
];

function detectionFromUrl(rawUrl: string): AtsDetection | null {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (host.endsWith('greenhouse.io')) {
    const board = url.searchParams.get('for') ?? (parts[0] === 'embed' ? undefined : parts[0]);
    if (board) return { type: 'GREENHOUSE', careersUrl: url.toString(), config: { board }, confidence: 1 };
  }
  if (host === 'jobs.lever.co' || host.endsWith('.lever.co')) {
    const site = parts[0];
    if (site) return { type: 'LEVER', careersUrl: url.toString(), config: { site }, confidence: 1 };
  }
  if (host === 'careers.smartrecruiters.com' || host === 'jobs.smartrecruiters.com') {
    const company = parts[0];
    if (company) return { type: 'SMARTRECRUITERS', careersUrl: url.toString(), config: { company }, confidence: 1 };
  }
  if (host.endsWith('.recruitee.com')) {
    const subdomain = host.split('.')[0];
    return { type: 'RECRUITEE', careersUrl: url.toString(), config: { subdomain }, confidence: 1 };
  }
  if (/\.jobs\.personio\.(de|com)$/.test(host)) {
    const subdomain = host.split('.')[0];
    return { type: 'PERSONIO', careersUrl: url.toString(), config: { subdomain, host }, confidence: 1 };
  }
  if (host.endsWith('.myworkdayjobs.com')) {
    const tenant = host.split('.')[0];
    const site = parts[0];
    if (tenant && site) return { type: 'WORKDAY', careersUrl: url.toString(), config: { tenant, site, origin: url.origin }, confidence: 1 };
  }
  return null;
}

export async function inspectCareerPage(rawUrl: string): Promise<AtsDetection | null> {
  const direct = detectionFromUrl(rawUrl);
  if (direct) return direct;
  try {
    const html = await fetchText(rawUrl);
    const $ = cheerio.load(html);
    const candidates = new Set<string>();
    $('a[href], iframe[src], script[src]').each((_, el) => {
      const raw = $(el).attr('href') ?? $(el).attr('src');
      if (!raw) return;
      try {
        const absolute = new URL(raw, rawUrl).toString();
        if (ATS_HOSTS.some((host) => new URL(absolute).hostname.includes(host))) candidates.add(absolute);
      } catch { /* ignore */ }
    });
    const embeddedUrls = html.match(/https?:\/\/[^\s\"'<>]+/g) ?? [];
    for (const embedded of embeddedUrls) {
      try {
        if (ATS_HOSTS.some((host) => new URL(embedded).hostname.includes(host))) candidates.add(embedded);
      } catch { /* ignore */ }
    }
    for (const candidate of candidates) {
      const detected = detectionFromUrl(candidate);
      if (detected) return { ...detected, careersUrl: rawUrl, confidence: 0.95, note: `ATS link discovered on ${rawUrl}` };
    }

    // No known ATS: keep the official career page as a JSON-LD fallback.
    const hasJobPosting = $('script[type="application/ld+json"]').toArray().some((el) => $(el).text().includes('JobPosting'));
    if (hasJobPosting || /career|carriere|carrière|recrutement|jobs/i.test(html)) {
      return { type: 'GENERIC_JSONLD', careersUrl: rawUrl, config: { startUrl: rawUrl }, confidence: 0.55, note: 'No supported ATS detected; generic career crawler fallback.' };
    }
  } catch { /* ignore */ }
  return null;
}

function scoreResult(companyName: string, result: { title?: string; link?: string; snippet?: string }): number {
  if (!result.link) return -999;
  let score = 0;
  const text = `${result.title ?? ''} ${result.snippet ?? ''}`.toUpperCase();
  const companyTokens = canonicalCompanyKey(companyName).split(' ').filter((x) => x.length >= 3);
  score += companyTokens.filter((t) => text.includes(t)).length * 2;
  if (/CAREER|CARRIÈRE|CARRIERE|RECRUT|JOBS|EMPLOI/.test(text)) score += 4;
  try {
    const host = new URL(result.link).hostname.toLowerCase();
    if (ATS_HOSTS.some((ats) => host.includes(ats))) score += 6;
    if (/linkedin|indeed|glassdoor|fashionjobs|welcometothejungle/.test(host)) score -= 8;
  } catch { score -= 10; }
  return score;
}

export async function discoverAts(
  companyName: string,
  fashionjobsSlug?: string,
): Promise<AtsDetection | null> {
  // Free path first: direct ATS slug probes cost nothing and resolve many companies.
  const probed = await probeAtsBySlug(companyName, fashionjobsSlug);
  if (probed) return probed;

  // Paid search is the fallback only, so a missing key degrades coverage rather
  // than blocking discovery entirely.
  if (!isSearchConfigured()) return null;

  const results = await searchWeb(`\"${companyName}\" careers recrutement jobs`);
  const ranked = results
    .filter((r) => r.link)
    .map((r) => ({ ...r, score: scoreResult(companyName, r) }))
    .sort((a, b) => b.score - a.score);

  for (const result of ranked.slice(0, 5)) {
    const detected = await inspectCareerPage(result.link!);
    if (detected) return detected;
  }
  return null;
}

export { detectionFromUrl };
