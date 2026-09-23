import { createHash } from 'node:crypto';
import { captureObservedAt } from '../../capture/context.js';
import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { CRAWLER_IDENTITY } from '../../lib/crawlerIdentity.js';

/**
 * Teamtailor career sites.
 *
 * The widest vendor in the catalogue — 13 sources including Galeries Lafayette,
 * Etam, Undiz, Orchestra and Normal.
 *
 * Its pages are client-rendered, so a JSON-LD parser finds nothing on the
 * listing, but every Teamtailor site publishes a JSON Feed at /jobs.json whose
 * items embed a full schema.org JobPosting under `_jobposting` — description,
 * location, country and salary in one request per page. No detail fetch needed.
 *
 * Verified 2026-09-01 on carrieres.groupegalerieslafayette.com: 100 items per
 * page with 3.1k-character descriptions, and a `next_url` for the rest.
 */

const PAGE_SIZE = 100;
/** Guard against a feed that keeps handing back a next_url. */
const MAX_PAGES = Number(process.env.TEAMTAILOR_MAX_PAGES ?? 40);

const USER_AGENT =
  CRAWLER_IDENTITY;

const HEADERS = { 'user-agent': USER_AGENT, accept: 'application/json' };

type JobPostingNode = {
  hiringOrganization?: { name?: string };
  title?: string;
  description?: string;
  identifier?: { value?: string } | string;
  datePosted?: string;
  employmentType?: string;
  baseSalary?: { currency?: string; value?: { minValue?: number; maxValue?: number; unitText?: string } };
  jobLocation?: Array<{
    address?: {
      addressLocality?: string;
      addressRegion?: string;
      postalCode?: string;
      addressCountry?: string;
    };
  }>;
};

type FeedItem = {
  id?: string;
  title?: string;
  url?: string;
  date_published?: string;
  content_html?: string;
  _jobposting?: JobPostingNode;
};

type Feed = { version?: string; feed_url?: string; items?: FeedItem[]; next_url?: string | null };


/**
 * L'hôte des fiches quand le feed n'est pas servi par lui : normal.eu publie
 * son feed sur jobs.normal.eu mais ses 478 fiches n'existent que sur
 * jobs.normal.{no,fr,…} — 478/478 liens « Postuler » en 404 (audit A5,
 * 2026-09-06). `config.jobOrigin` remplace l'hôte des URL d'offre.
 */
function rehost(url: string | undefined, jobOrigin?: string): string {
  if (!url || !jobOrigin) return url ?? '';
  try {
    const target = new URL(jobOrigin);
    const u = new URL(url);
    u.protocol = target.protocol;
    u.host = target.host;
    return u.toString();
  } catch {
    return url;
  }
}

export function toNormalized(item: FeedItem, jobOrigin?: string): NormalizedJob | null {
  const posting = item._jobposting;
  const title = item.title ?? posting?.title;
  if (!title) return null;

  const address = posting?.jobLocation?.[0]?.address;
  const posted = item.date_published ?? posting?.datePosted;
  const postedAt = posted ? new Date(posted) : undefined;

  return {
    externalId: String(item.id ?? item.url ?? title),
    title,
    company: posting?.hiringOrganization?.name?.trim() || undefined,
    employerEvidence: posting?.hiringOrganization?.name?.trim()
      ? { rawName: posting.hiringOrganization.name, path: '_jobposting.hiringOrganization.name', rule: 'HIRING_ORGANIZATION_LABEL' }
      : undefined,
    location:
      [address?.addressLocality, address?.addressRegion, address?.postalCode]
        .filter(Boolean)
        .join(', ') || undefined,
    country: address?.addressCountry,
    contract: posting?.employmentType,
    // GL publishes a real EUR/YEAR band here; dropping it made every fiche
    // read half-empty while the vendor was handing us the number.
    salaryMin: posting?.baseSalary?.value?.minValue,
    salaryMax: posting?.baseSalary?.value?.maxValue,
    salaryCurrency: posting?.baseSalary?.currency,
    salaryPeriod: posting?.baseSalary?.value?.unitText,
    // The feed carries the whole posting; content_html is the same text.
    description: htmlToPlainText(posting?.description ?? item.content_html),
    url: rehost(item.url, jobOrigin),
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: item,
  };
}

/**
 * Reads a whole Teamtailor board.
 * `config.origin` is the careers host, e.g. "https://jobs.normal.fr".
 */
export async function fetchTeamtailorJobs(
  config: Record<string, unknown>,
): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('Teamtailor origin missing');
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('Teamtailor requires an unfiltered HTTPS board origin');
  }
  const maxPages = config.maxPages === undefined ? MAX_PAGES : Number(config.maxPages);
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES) throw new Error('Invalid Teamtailor page budget');
  const jobOrigin = typeof config.jobOrigin === 'string' ? config.jobOrigin : undefined;
  const jobs: NormalizedJob[] = [];
  const ids = new Set<string>();
  /** La charge utile déjà vue pour chaque identifiant : distingue un recouvrement d'une contradiction. */
  const vus = new Map<string, string>();
  const visited = new Set<string>();
  const endpoint = `${origin}/jobs.json`;
  /**
   * La preuve d'énumération, page par page (lot F3, 2026-09-16). `canonicalIds` sont les `externalId` produits
   * par `toNormalized` — le seul ensemble comparable à `JobSource.externalId`, donc le seul par lequel une
   * absence puisse être prouvée. Une ligne sans identifiant fait échouer la page (ci-dessous), jamais une
   * preuve partielle : quand la preuve existe, elle nomme tout ce qui a été vu.
   */
  const observedAt = captureObservedAt().toISOString();
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  const enumeration = (termination: string, traversalComplete: boolean): NonNullable<AdapterResult['enumeration']> => ({
    method: 'DOCUMENTED_JSON_FEED', endpoint, pages: pageEvidence.length, rawCount: jobs.length, termination,
    documentation: 'https://www.jsonfeed.org/version/1.1/',
    canonicalAbsenceProofUsable: true, enumerationTraversalComplete: traversalComplete,
    ...(traversalComplete ? {} : { blockers: [termination] }), pageEvidence,
  });
  let url = `${origin}/jobs.json?per_page=${PAGE_SIZE}`;
  for (let page = 0; page < maxPages; page++) {
    const current = new URL(url);
    current.searchParams.sort();
    if (visited.has(current.href)) throw new Error('Teamtailor pagination cycle');
    visited.add(current.href);
    const feed = await fetchJson<Feed>(url, { headers: HEADERS });
    if (!feed || !['https://jsonfeed.org/version/1', 'https://jsonfeed.org/version/1.1'].includes(feed.version ?? '') || !Array.isArray(feed.items)) {
      throw new Error('Invalid Teamtailor JSON Feed shape');
    }
    if (typeof feed.feed_url !== 'string') throw new Error('Teamtailor feed identity missing');
    const identity = new URL(feed.feed_url, origin);
    if (identity.origin !== base.origin || identity.pathname !== '/jobs.json') throw new Error('Teamtailor foreign feed identity');
    const pageIds: string[] = [];
    for (const item of feed.items) {
      if (!item || !['string', 'number'].includes(typeof item.id) || !String(item.id).trim()) throw new Error('Teamtailor missing item identity');
      const job = toNormalized(item, jobOrigin);
      if (!job || !job.title.trim() || !/^https?:\/\//.test(job.url)) throw new Error('Teamtailor invalid job entry');
      /*
       * UN RECOUVREMENT DE PAGINATION N'EST PAS UNE CONTRADICTION.
       *
       * Mesuré sur galeries-lafayette le 2026-09-21 : deux pages (100 + 59 items), `next_url`
       * s'arrête normalement, aucune boucle — et 2 identifiants sur 157 servis deux fois, aux
       * charges utiles STRICTEMENT IDENTIQUES. C'est ce que produit un flux qui bouge entre deux
       * requêtes. Refuser la collecte entière coûtait 157 offres pour 2 doublons inoffensifs.
       *
       * Ce qui reste refusé : deux versions DIFFÉRENTES d'un même identifiant. La preuve
       * d'énumération sert à attester une absence, et deux titres pour un identifiant la rendent
       * indécidable — on ne sait plus lequel fait foi.
       */
      const deja = vus.get(job.externalId);
      if (deja !== undefined) {
        if (deja !== JSON.stringify(item)) throw new Error('Teamtailor duplicate item across pages');
        continue; // Même offre, même contenu : déjà comptée, et la page ne la renomme pas.
      }
      vus.set(job.externalId, JSON.stringify(item));
      ids.add(job.externalId);
      jobs.push(job);
      pageIds.push(job.externalId);
    }
    pageEvidence.push({ url, checkedAt: observedAt, sha256: createHash('sha256').update(JSON.stringify(feed)).digest('hex'),
      offset: jobs.length - pageIds.length, pagination: null, ids: pageIds, canonicalIds: pageIds,
      publisherCounter: String(feed.items.length), componentCounters: [] });
    if (feed.next_url === undefined || feed.next_url === null) return { jobs, complete: true, truncated: false,
      // A valid single empty feed with no continuation explicitly declares zero.
      // Positive boards still do not acquire an invented global publisher total.
      ...(jobs.length === 0 && pageEvidence.length === 1 ? { declaredTotal: 0 } : {}),
      enumeration: enumeration('NEXT_URL_NULL', true) };
    if (typeof feed.next_url !== 'string' || !feed.next_url.trim()) throw new Error('Teamtailor invalid next_url');
    if (!feed.items.length) throw new Error('Teamtailor empty page with continuation');
    const next = new URL(feed.next_url, url);
    if (next.origin !== base.origin || next.pathname !== '/jobs.json' || next.username || next.password || next.hash ||
        [...next.searchParams.keys()].some(key => !['page', 'per_page'].includes(key))) {
      throw new Error('Teamtailor foreign or filtered continuation');
    }
    url = next.href;
  }
  // There is still a continuation: persist partial observations if desired,
  // but never use them as evidence that an unseen job disappeared.
  return { jobs, complete: false, truncated: true, enumeration: enumeration('PAGE_BUDGET_REACHED', false) };
}
