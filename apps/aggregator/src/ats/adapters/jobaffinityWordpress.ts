import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { createHash } from 'node:crypto';
import { fetchText, fetchJson, HttpStatusError } from '../../lib/http.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

export type BoardRow = { attrs: Record<string, string>; title: string; text: string; contract?: string };
export type BoardConfig = { listingUrl: string; employer: string; brands?: Record<string, string> };
export type Commune = { nom: string; code: string; codesPostaux: string[]; departement?: { code: string }; region?: { nom: string } };
export type ApplicationEvidence = { url: string; status: number; state: 'OPEN' | 'CLOSED'; checkedAt?: string; heading?: string; formAction?: string };
export function parseJobaffinityApplication(html: string, url: string): ApplicationEvidence {
  const $ = cheerio.load(html), form = $('form#identity[method=post]');
  const heading = $('h1').text().trim();
  if (!form.length && $('h1').toArray().some(e => /^Ce poste n[’']est plus ouvert\.?$/.test($(e).text().trim()))) return { url, status: 200, state: 'CLOSED', heading };
  if (form.length !== 1 || !heading || jobaffinityApplyUrl(form.attr('action') ?? '') !== url || !$('body').text().includes('Dossier de candidature')) throw new Error(`JobAffinity: application response is not a matching open form ${url}`);
  return { url, status: 200, state: 'OPEN', heading, formAction: url };
}
export type GeoEvidence = { url: string; communes: Commune[]; postalLookup?: { url: string; communes: Commune[] } };
const cityKey = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+\d{1,2}\s*(?:ER|E|EME)(?:\s+ARRONDISSEMENT)?$/, '').replace(/\bSTE\b/g, 'SAINTE').replace(/\bST\b/g, 'SAINT').replace(/[^A-Z0-9]/g, '');
export const coordinateKey = (row: BoardRow) => ['latitude', 'longitude'].map(k => row.attrs[`data-${k}`]).join(',');
const clean = (s: string | undefined) => s?.trim() || undefined;
export function jobaffinityApplyUrl(raw: string): string {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.hostname !== 'jobaffinity.fr' || u.port || u.username || u.password || !/^\/apply\/[a-z0-9]{10,64}\/?$/.test(u.pathname)) throw new Error('JobAffinity: invalid application identity');
  return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
}
function boardUrl(value: string): URL {
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash || u.username || u.password) throw new Error('JobAffinity WordPress requires an unfiltered HTTPS board root');
  return u;
}
export function parseJobaffinityGrid(html: string, listingUrl: string): { rows: BoardRow[]; declaredTotal: number } {
  const origin = boardUrl(listingUrl).origin;
  const $ = cheerio.load(html);
  const counter = $('#job-counter');
  const rawTotal = counter.text().trim();
  if (counter.length !== 1 || !/^\d+$/.test(rawTotal)) throw new Error('JobAffinity: missing enumeration counter, not an empty board');
  const rows: BoardRow[] = $('.grid-item').toArray().map(e => ({ attrs: { ...e.attribs }, title: $(e).find('h3').text().trim(), text: $(e).text().trim(), contract: clean($(e).find('.contracttype').text()) }));
  const ids = new Set<string>(), tokens = new Set<string>();
  for (const r of rows) {
    const id = r.attrs['data-id'];
    if (!/^\d+$/.test(id || '') || !r.title || ids.has(id)) throw new Error('JobAffinity: invalid or duplicate listing row');
    ids.add(id);
    const apply = jobaffinityApplyUrl(r.attrs['data-applyurl']);
    if (tokens.has(apply)) throw new Error('JobAffinity: duplicate application token within board');
    tokens.add(apply);
    const detail = new URL(r.attrs['data-jobdescurl'].trim());
    if (detail.origin !== origin || detail.search || detail.hash) throw new Error('JobAffinity: foreign detail URL');
  }
  const declaredTotal = Number(rawTotal);
  if (!Number.isSafeInteger(declaredTotal) || declaredTotal !== rows.length) throw new Error('JobAffinity: partial listing');
  return { rows, declaredTotal };
}
export function normalizeJobaffinityPost(row: BoardRow, post: any, config: BoardConfig, geo?: GeoEvidence): NormalizedJob {
  const origin = boardUrl(config.listingUrl).origin;
  if (!post || String(post.id) !== row.attrs['data-id'] || post.status !== 'publish' || post.type !== 'post' || new URL(post.link).origin !== origin || post.link !== row.attrs['data-jobdescurl'].trim()) throw new Error('JobAffinity: detail identity mismatch');
  const url = jobaffinityApplyUrl(row.attrs['data-applyurl']);
  const $ = cheerio.load(String(post.content?.rendered ?? ''));
  const applyLinks = $('.intuitionapply a[href]').toArray().map(a => jobaffinityApplyUrl($(a).attr('href')!));
  if (!applyLinks.length || applyLinks.some(link => link !== url)) throw new Error('JobAffinity: listing/detail application mismatch');
  const companyHtml = $('.intuitioncompanydescription').html();
  if (!companyHtml) throw new Error(`JobAffinity: incomplete job description ${post.id}`);
  $('.intuitionapply,script,style').remove();
  const description = cheerio.load($.html().replace(/<\/(p|li|div|h[1-6])>/gi, '</$1>\n')).text().replace(/\n\s*\n/g, '\n').trim();
  const brand = clean(row.attrs['data-marque']);
  const company = brand ? config.brands?.[brand] : config.employer;
  if (!company?.trim()) throw new Error(`JobAffinity: unreviewed employer label ${brand ?? '(empty)'}`);
  // Explicit UTC publication time of the employer's post, never modified/firstSeen.
  const dateRaw = post.date_gmt;
  const postedAt = typeof dateRaw === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(dateRaw) ? new Date(`${dateRaw}Z`) : undefined;
  if (!postedAt || !Number.isFinite(postedAt.getTime()) || postedAt.toISOString().slice(0, 19) !== dateRaw) throw new Error('JobAffinity: invalid publication date');
  const postalCode = clean(row.attrs['data-codepostal']), city = clean(row.attrs['data-ville']);
  const latitude = Number(row.attrs['data-latitude']), longitude = Number(row.attrs['data-longitude']);
  // Coordinates + matching postal code corroborated by the French government.
  // Approximate coordinates with a contradictory postal code are kept only in RAW.
  const matches = geo?.communes.filter(c => c.codesPostaux.includes(postalCode ?? '') && /^(?:0[1-9]|[1-8]\d|9[0-5]|2[AB])$/.test(c.departement?.code ?? '')) ?? [];
  const geoProven = matches.length === 1;
  const postalMatches = geo?.postalLookup?.communes.filter(c => c.codesPostaux.includes(postalCode ?? '') && cityKey(c.nom) === cityKey(city ?? '') && /^(?:0[1-9]|[1-8]\d|9[0-5]|2[AB])$/.test(c.departement?.code ?? '')) ?? [];
  const cityMatches = geo?.communes.filter(c => cityKey(c.nom) === cityKey(city ?? '') && /^(?:0[1-9]|[1-8]\d|9[0-5]|2[AB])$/.test(c.departement?.code ?? '')) ?? [];
  const pointCityProven = cityMatches.length === 1;
  const countryProven = geoProven || postalMatches.length === 1 || pointCityProven;
  const commune = geoProven ? matches[0] : postalMatches.length === 1 ? postalMatches[0] : pointCityProven ? cityMatches[0] : undefined;
  // The Intersport template emits Temps plein for ALL 993 cards, including
  // explicit Temps partiel titles. Use the title assertion, never this default.
  const part = /\btemps\s+partiel\b/i.test(row.title), full = /\btemps\s+plein\b/i.test(row.title);
  return { externalId: url.split('/').at(-1)!, url, title: row.title, company, description,
    city, postalCode: pointCityProven && !geoProven && !postalMatches.length ? undefined : postalCode, location: [postalCode, city].filter(Boolean).join(' ') || undefined,
    ...(countryProven ? { country: 'FR', region: commune?.region?.nom } : {}),
    ...(geoProven || pointCityProven ? { latitude, longitude } : {}),
    contract: clean(row.attrs['data-contract-type']) ?? row.contract,
    workingTime: part !== full ? (part ? 'part-time' : 'full-time') : undefined,
    postedAt,
    ...(!$('.intuitionpositiondescription').text().trim() ? { publicationHold: 'MISSING_EMPLOYER_MISSION' } : {}),
    raw: { board: { url: config.listingUrl, row }, post, geographyEvidence: geo ?? null,
      fieldEvidence: { company: { method: brand ? 'REVIEWED_BOARD_BRAND' : 'REVIEWED_BOARD_OWNER', value: company, rawLabel: brand ?? null },
        postedAt: { method: 'EMPLOYER_WORDPRESS_DATE_GMT', sourcePath: 'post.date_gmt', rawValue: dateRaw },
        country: { method: geoProven ? 'GOVERNMENT_POINT_AND_POSTAL' : postalMatches.length === 1 ? 'GOVERNMENT_EXACT_CITY_AND_POSTAL' : pointCityProven ? 'GOVERNMENT_POINT_AND_CITY' : 'UNRESOLVED_SOURCE_LOCATION', communeCode: commune?.code ?? null },
        description: { method: 'FULL_EMPLOYER_POST', hasMission: Boolean($('.intuitionpositiondescription').text().trim()), hasProfile: Boolean($('.intuitionprofiledescription').text().trim()) },
        workingTime: { method: part !== full ? 'EXPLICIT_TITLE' : 'UNRESOLVED_TEMPLATE_DEFAULT', rawLabel: row.attrs['data-temps-travail'] ?? null } } },
  };
}
export async function fetchJobaffinityWordpressJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const c = config as BoardConfig;
  const origin = boardUrl(c.listingUrl).origin;
  if (!c.employer?.trim()) throw new Error('JobAffinity: reviewed board employer required');
  const html = await fetchText(c.listingUrl);
  const { rows, declaredTotal } = parseJobaffinityGrid(html, c.listingUrl);
  const posts = new Map<number, any>();
  // Only IDs in the active board: WP contains old published posts too (1077 vs 993).
  for (let i = 0; i < rows.length; i += 100) {
    const ids = rows.slice(i, i + 100).map(r => Number(r.attrs['data-id']));
    const page = await fetchJson<any[]>(`${origin}/wp-json/wp/v2/posts?per_page=100&include=${ids.join(',')}`);
    if (!Array.isArray(page) || page.length !== ids.length || new Set(page.map(p => p.id)).size !== ids.length || page.some(p => !ids.includes(p.id))) throw new Error('JobAffinity: incomplete detail batch');
    for (const p of page) posts.set(p.id, p);
  }
  const limit = pLimit(3), geographies = new Map<string, Promise<GeoEvidence>>();
  const applications = pLimit(3);
  const postalLookups = new Map<string, Promise<{ url: string; communes: Commune[] }>>();
  const jobs = await Promise.all(rows.map(async row => {
    const key = coordinateKey(row);
    const coords = key.split(',').map(Number);
    let evidence: GeoEvidence | undefined;
    if (key.split(',').every(Boolean) && coords.every(Number.isFinite) && Math.abs(coords[0]) <= 90 && Math.abs(coords[1]) <= 180) {
      if (!geographies.has(key)) geographies.set(key, limit(async () => {
        const url = `https://geo.api.gouv.fr/communes?lat=${coords[0]}&lon=${coords[1]}&fields=nom,code,codesPostaux,region,departement&format=json`;
        const communes = await fetchJson<Commune[]>(url);
        if (!Array.isArray(communes) || communes.some(v => !v.code || !Array.isArray(v.codesPostaux))) throw new Error('JobAffinity: invalid government geography response');
        return { url, communes };
      }));
      // Transport failure fails the sweep; never erase previously proven geography.
      evidence = await geographies.get(key);
    }
    const postal = row.attrs['data-codepostal'];
    if (evidence && /^\d{5}$/.test(postal ?? '') && !evidence.communes.some(c => c.codesPostaux.includes(postal))) {
      if (!postalLookups.has(postal)) postalLookups.set(postal, limit(async () => {
        const url = `https://geo.api.gouv.fr/communes?codePostal=${postal}&fields=nom,code,codesPostaux,region,departement&format=json`;
        const communes = await fetchJson<Commune[]>(url);
        if (!Array.isArray(communes) || communes.some(c => !c.code || !Array.isArray(c.codesPostaux))) throw new Error('JobAffinity: invalid postal reference response');
        return { url, communes };
      }));
      evidence = { ...evidence, postalLookup: await postalLookups.get(postal) };
    }
    const job = normalizeJobaffinityPost(row, posts.get(Number(row.attrs['data-id'])), c, evidence);
    const application = await applications(async (): Promise<ApplicationEvidence> => {
      try { return parseJobaffinityApplication(await fetchText(job.url), job.url); }
      catch (e) { if (e instanceof HttpStatusError && [404, 410].includes(e.status)) return { url: job.url, status: e.status, state: 'CLOSED' }; throw e; }
    });
    applyJobaffinityEvidence(job, application);
    Object.assign(job.raw as object, { applicationEvidence: application });
    Object.assign(job.raw as object, { listingEvidence: { sha256: createHash('sha256').update(html).digest('hex'), declaredTotal } });
    return job;
  }));
  const withdrawn = jobs.filter(j => j.publicationWithdrawnAt).length;
  // A host-wide 404 incident is not evidence that an entire board disappeared.
  if (jobs.length >= 50 && withdrawn / jobs.length > 0.5) throw new Error('JobAffinity: mass application withdrawal requires renewed review');
  return { jobs, declaredTotal, truncated: false, complete: true };
}

/** The application token is the identity; retain both board and current ATS title. */
export function applyJobaffinityEvidence(job: NormalizedJob, application: ApplicationEvidence): void {
  if (application.url !== job.url) throw new Error('Application evidence identity mismatch');
  if (application.state === 'CLOSED') {
    application.checkedAt ??= new Date().toISOString();
    job.publicationHold = application.status === 200 ? 'APPLICATION_EXPLICITLY_CLOSED' : `APPLICATION_HTTP_${application.status}`;
    job.publicationWithdrawnAt = new Date(application.checkedAt);
  } else if (application.heading) {
    if (/modèle\s+expiré/i.test(application.heading)) {
      job.publicationHold = 'APPLICATION_TEMPLATE_EXPIRY_CONTRADICTION';
    } else {
      job.title = application.heading;
      const part = /\btemps\s+partiel\b/i.test(job.title), full = /\btemps\s+plein\b/i.test(job.title);
      job.workingTime = part !== full ? (part ? 'part-time' : 'full-time') : undefined;
      const raw = job.raw as any;
      raw.fieldEvidence.title = { method: 'MATCHING_ATS_APPLICATION_HEADING', sourcePath: 'applicationEvidence.heading' };
      raw.fieldEvidence.workingTime.method = part !== full ? 'EXPLICIT_ATS_TITLE' : 'UNRESOLVED_TEMPLATE_DEFAULT';
    }
  }
}
