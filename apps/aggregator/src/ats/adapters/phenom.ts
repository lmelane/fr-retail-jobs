import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { fetchJson, fetchText, DEFAULT_DETAIL_CONCURRENCY } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import { extractJobPostings } from '../../connectors/generic/jsonLdSitemap.js';
import { employmentTermsFrom } from '../../normalize/employment.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { CRAWLER_IDENTITY } from '../../lib/crawlerIdentity.js';

/**
 * Phenom People career sites.
 *
 * The biggest single win in the catalogue: Foot Locker, Primark, Pandora,
 * Rolex, Goyard and New Balance all run Phenom — roughly 5,000 offers behind
 * one adapter.
 *
 * Their pages are JS-rendered, which is why a JSON-LD parser reported zero, but
 * `/api/jobs` is public and returns everything: title, city, country,
 * description AND latitude/longitude, so these rows never need geocoding.
 *
 * Verified 2026-09-01 on careers.footlocker.com: 2814 jobs, 3.1k-character
 * descriptions, coordinates included.
 */

/**
 * The API honours `limit` (not `size`) and paginates with a 1-based `page`.
 * `offset`, `from` and `start` are all silently ignored — they return page one
 * every time, which looks like a board with only ten jobs.
 */
const PAGE_SIZE = 100;
/** Guard against a changed response shape paginating forever. */
const MAX_PAGES = Number(process.env.PHENOM_MAX_PAGES ?? 80);

const USER_AGENT =
  CRAWLER_IDENTITY;

const HEADERS = { 'user-agent': USER_AGENT, accept: 'application/json' };

type PhenomJobData = {
  slug?: string;
  req_id?: string;
  /** Locale of this entry ("en-us", "fr-fr"): the same requisition may be served once per language. */
  language?: string;
  title?: string;
  description?: string;
  city?: string;
  state?: string;
  country?: string;
  country_code?: string;
  postal_code?: string;
  latitude?: number | string;
  longitude?: number | string;
  create_date?: string;
  posted_date?: string;
  applyUrl?: string;
  apply_url?: string;
  category?: string;
  /** schema.org value: "FULL_TIME" / "PART_TIME" — a working time, not a contract. */
  employment_type?: string;
  /** The employer as published ("Foot Locker") — never the catalogue line's fallback ("Foot Locker France" on 1 769 US posts, audit a4). */
  hiring_organization?: string;
  /** Tenant-configured: Foot Locker files the contract in tags2 ("Regular Part-Time") and the banner in tags4 ("Kids Foot Locker"). */
  tags1?: string[];
  tags2?: string[];
  tags3?: string[];
  tags4?: string[];
  tags5?: string[];
  tags6?: string[];
  tags7?: string[];
  tags8?: string[];
  tags9?: string[];
};

/** Every `tagsN` value, whatever the tenant filed there. */
function tagValues(data: PhenomJobData): unknown[] {
  return Object.entries(data)
    .filter(([key]) => /^tags\d+$/.test(key))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));
}

/**
 * The brand to credit the offer to.
 *
 * `config.brandTag` names the tag that carries the banner on tenants that have
 * one (Foot Locker: `tags4` = "Kids Foot Locker", "Champs Sports"…); it is
 * tenant-specific, so it is opt-in per catalogue line. Otherwise the employer
 * the API publishes — always better than the catalogue label.
 */
function brandOf(data: PhenomJobData, config: Record<string, unknown>): string | undefined {
  const tag = config.brandTag ? (data as Record<string, unknown>)[String(config.brandTag)] : undefined;
  const banner = Array.isArray(tag) ? tag[0] : tag;
  const brand = banner ? String(banner).trim() : '';
  return brand || data.hiring_organization?.trim() || undefined;
}

type PhenomResponse = {
  jobs?: Array<{ data?: PhenomJobData }>;
  totalCount?: number;
  count?: number;
};


/** One `/api/jobs` entry → one posting. Exported for tests (no network). */
export function parsePhenomJob(data: PhenomJobData, origin: string, config: Record<string, unknown> = {}): NormalizedJob | null {
  if (!data.title) return null;

  const id = data.slug ?? data.req_id;
  const posted = data.create_date ?? data.posted_date;
  const postedAt = posted ? new Date(posted) : undefined;
  // employment_type is a working time; the contract, when the tenant publishes
  // it, sits in a tag ("Regular Part-Time"). Only values naming a term are kept.
  const terms = employmentTermsFrom([data.employment_type, ...tagValues(data)]);

  return {
    externalId: String(id ?? data.title),
    title: data.title,
    location: [data.city, data.state, data.postal_code].filter(Boolean).join(', ') || undefined,
    // country_code is ISO-2 ("FR"); country is the display name ("France").
    country: data.country_code ?? data.country,
    contract: terms,
    workingTime: terms,
    company: brandOf(data, config),
    city: data.city,
    region: data.state,
    postalCode: data.postal_code,
    // Phenom ships coordinates, so these rows skip geocoding.
    latitude: Number.isFinite(Number(data.latitude)) ? Number(data.latitude) : undefined,
    longitude: Number.isFinite(Number(data.longitude)) ? Number(data.longitude) : undefined,
    description: htmlToPlainText(data.description),
    // Phenom livre `apply_url` = l'étape de CONNEXION iCIMS (`/jobs/<id>/login`,
    // 2 842/2 842 liens Foot Locker sur une page de login) ; la fiche publique est
    // `/jobs/<id>/job` (audit A5, 2026-09-06).
    url: publicJobUrl(data.applyUrl ?? data.apply_url ?? `${origin}/job/${id ?? ''}`),
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: data,
  };
}

/** La fiche publique, jamais l'étape de connexion iCIMS que Phenom met dans apply_url (`/jobs/<id>/login` → `/jobs/<id>/job`). */
export function publicJobUrl(url: string): string {
  return url.replace(/(\/jobs\/[^/?#]+)\/login(?=[/?#]|$)/, '$1/job');
}

/**
 * Reads a whole Phenom board.
 * `config.origin` is the careers host, e.g. "https://careers.footlocker.com".
 */
export async function fetchPhenomJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('Phenom origin missing');

  // Le dialecte est lu AVANT toute requête : un tenant CareerConnect ne doit jamais recevoir la requête
  // Foot Locker, qui lui rend 500 et ferait diagnostiquer une source cassée.
  if (phenomDialect(config) === 'CAREER_CONNECT_WIDGETS') {
    // Le préfixe de locale du portail : sans lui l'URL publique redirige vers l'accueil (mesuré).
    return fetchCareerConnectJobs(origin, typeof config.localePath === 'string' ? config.localePath : undefined);
  }

  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  let declaredTotal: number | undefined;
  const issues = new Set<string>();
  let pages = 0, rawCount = 0, withoutData = 0, repeatedIds = 0, languageVariants = 0, termination = 'PAGE_BUDGET_EXHAUSTED';
  const languageOf = new Map<string, string>();
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${origin}/api/jobs?limit=${PAGE_SIZE}&page=${page}`;
    const response = await fetchJson<PhenomResponse>(url, { headers: HEADERS });

    const batch = response.jobs ?? [];
    pages++; rawCount += batch.length;
    let fresh = 0;
    const pageIds: string[] = [];

    for (const entry of batch) {
      if (!entry.data) { withoutData++; continue; }
      const job = parsePhenomJob(entry.data, origin, config);
      if (!job) continue;
      pageIds.push(job.externalId);
      // Foot Locker, 2026-09-09 : 2 850 entrées servies pour 2 850 annoncées,
      // 2 839 identifiants distincts — 11 offres revenaient sur deux pages
      // (pagination instable) et 11 autres n'ont donc jamais été servies. Le
      // doublon est compté et nommé ; il refuse la preuve, il ne la remplace pas.
      if (seen.has(job.externalId)) {
        // Foot Locker, 2026-09-10 (29 real pages): the 11 "repeated" ids were the
        // SAME requisition served in a second LANGUAGE (fr-fr then en-us, en-us then
        // nl-be) — totalCount 2 861 sums the language counts, 2 850 requisitions.
        // A language variant is a row the publisher announced and we accounted
        // for, not a posting lost to an unstable sort; the two stay distinct.
        const language = String(entry.data.language ?? '');
        if (language && languageOf.get(job.externalId) && languageOf.get(job.externalId) !== language) { languageVariants++; continue; }
        repeatedIds++; continue;
      }
      seen.add(job.externalId);
      languageOf.set(job.externalId, String(entry.data.language ?? ''));
      jobs.push(job);
      fresh++;
    }
    const pageTotal = response.totalCount ?? response.count;
    pageEvidence.push({ url, checkedAt: new Date().toISOString(), sha256: createHash('sha256').update(JSON.stringify(response)).digest('hex'), offset: (page - 1) * PAGE_SIZE, pagination: null,
      ids: pageIds, publisherCounter: pageTotal === undefined ? '' : `total=${pageTotal}`, componentCounters: [`entries=${batch.length}`, `languageVariants=${languageVariants}`, `uniqueIds=${seen.size}`, `repeated=${repeatedIds}`, `withoutData=${withoutData}`] });

    const total = response.totalCount ?? response.count;
    if (total !== undefined) {
      if (declaredTotal === undefined) declaredTotal = total;
      else if (declaredTotal !== total) issues.add('SOURCE_TOTAL_CHANGED');
    }

    if (total !== undefined && jobs.length + languageVariants >= total) { termination = 'PUBLISHER_TOTAL_REACHED'; break; }
    // A page that adds nothing new is the end of the board (or a loop).
    if (fresh === 0) { termination = batch.length ? 'REPEATED_PAGE' : 'EMPTY_PAGE'; break; }
    /**
     * Foot Locker, 2026-09-09 : 2 836 lues pour 2 847 déclarées. Une page
     * COURTE n'est pas la fin quand le total n'est pas atteint — l'API peut
     * servir une page allégée (entrées sans `data`, doublons) au milieu du
     * board ; on ne s'arrête sur une page courte qu'en l'absence de total.
     */
    if (total === undefined && batch.length < PAGE_SIZE) { termination = 'SHORT_PAGE'; break; }
  }

  if (repeatedIds) issues.add('REPEATED_IDS_ACROSS_PAGES');
  if (languageVariants) issues.add('LANGUAGE_VARIANTS_DEDUPLICATED');
  // Proven when every announced entry is accounted for: a distinct requisition, or a language variant of one already kept.
  const complete = declaredTotal !== undefined && jobs.length + languageVariants === declaredTotal && repeatedIds === 0 && !issues.has('SOURCE_TOTAL_CHANGED') && termination !== 'PAGE_BUDGET_EXHAUSTED';
  if (!complete) issues.add('ENUMERATION_NOT_PROVEN');
  return { jobs, declaredTotal, complete, truncated: termination === 'PAGE_BUDGET_EXHAUSTED' || (declaredTotal !== undefined && jobs.length + languageVariants < declaredTotal),
    enumeration: { method: 'PUBLISHER_TOTAL_COUNT_JSON_PAGINATION', endpoint: `${origin}/api/jobs`, pages, rawCount, termination, issues: [...issues],
      pageEvidence, scopes: [{ scope: 'jobs', declaredTotal: declaredTotal ?? -1, uniqueIds: jobs.length, pages, complete }, { scope: 'languageVariants', declaredTotal: languageVariants, uniqueIds: languageVariants, pages, complete: true }, { scope: 'entriesWithoutData', declaredTotal: withoutData, uniqueIds: withoutData, pages, complete: true }] } };
}

/**
 * Coordinates Phenom already provides, so these rows skip geocoding entirely.
 * Returns null when the payload has none.
 */
export function phenomCoordinates(raw: unknown): { latitude: number; longitude: number } | null {
  const data = raw as PhenomJobData | undefined;
  const latitude = Number(data?.latitude);
  const longitude = Number(data?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────────────
 * PHENOM N'EST PAS UNE API UNIFORME — le second dialecte, CareerConnect.
 *
 * Mesuré le 2026-09-14 : le même chemin `/api/jobs` rend HTTP 200 chez Foot Locker et **500** chez Hugo Boss
 * et Skechers. J'en avais conclu « sources bloquées » — c'était faux. Les deux servent leurs offres par
 * `POST /widgets` avec `ddoKey: refineSearch`, la configuration que leurs pages déclarent elles-mêmes :
 * Hugo Boss **784** offres, Skechers **1 656**.
 *
 * *Un 500 sur un endpoint qu'on a deviné ne dit rien de la source.*
 *
 * Le dialecte est donc une CONFIGURATION EXPLICITE, jamais une cascade d'endpoints essayés jusqu'à ce que
 * l'un réponde : une telle cascade masquerait une panne réelle en la faisant passer pour un changement de
 * dialecte, et on aurait remplacé un diagnostic par un tirage au sort.
 * ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

export const PHENOM_DIALECTS = ['FOOTLOCKER_API_JOBS', 'CAREER_CONNECT_WIDGETS'] as const;
export type PhenomDialect = (typeof PHENOM_DIALECTS)[number];

/** Le dialecte déclaré, ou le dialecte historique. Un nom inconnu est REFUSÉ, jamais rabattu sur un défaut. */
export function phenomDialect(config: Record<string, unknown>): PhenomDialect {
  const declared = typeof config.dialect === 'string' ? config.dialect : '';
  if (!declared) return 'FOOTLOCKER_API_JOBS';
  if ((PHENOM_DIALECTS as readonly string[]).includes(declared)) return declared as PhenomDialect;
  throw new Error(`phenom: dialecte inconnu « ${declared} » — attendu ${PHENOM_DIALECTS.join(' | ')}`);
}

/**
 * La requête CareerConnect. `country: 'global'` est demandé EXPLICITEMENT : mesuré sur Skechers, le backend
 * rend 1 656 offres que la locale soit `fr/France` ou `en/global` — on ne veut pas dépendre de ce
 * comportement pour ne pas réduire un jour la source à un marché.
 */
export function careerConnectRequest(origin: string, page: { from: number; size: number }): {
  url: string; method: 'POST'; body: Record<string, unknown>;
} {
  return {
    url: `${origin}/widgets`,
    method: 'POST',
    body: {
      lang: 'en', deviceType: 'desktop', country: 'global', pageName: 'search-results',
      ddoKey: 'refineSearch', jdsource: 'facets', isSliderEnable: false,
      jobs: true, counts: true, all_fields: ['category', 'country', 'state', 'city'],
      from: page.from, size: page.size,
    },
  };
}

/** Une offre du dialecte CareerConnect. Les champs sont ceux réellement servis (fixture Hugo Boss, 2026-09-14). */
export type CareerConnectJob = {
  jobSeqNo?: string; jobId?: string | number; title?: string; category?: string;
  country?: string; state?: string; city?: string; cityState?: string;
  dateCreated?: string; postedDate?: string; descriptionTeaser?: string;
  latitude?: string | number; longitude?: string | number; hiringType?: string; type?: string;
};

/** Le slug d'URL publique Phenom : titre en minuscules, séparateurs normalisés. */
function slugify(title: string): string {
  return title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'job';
}

/**
 * Normalise une offre CareerConnect.
 *
 * L'identifiant est `jobSeqNo`, celui que l'ÉDITEUR expose (`HUBOGLOBAL143861EXTERNALENGLOBAL` : tenant,
 * requisition, visibilité, langue). On ne le fabrique pas — un identifiant inventé ne survit pas à un
 * changement de tri, et P7 a montré ce que coûte une identité instable.
 *
 * La liste ne porte AUCUNE URL : l'adresse publique est dérivée du gabarit Phenom `/job/<id>/<slug>`.
 */
export function parseCareerConnectJob(
  data: CareerConnectJob,
  origin: string,
  options: { localePath?: string } = {},
): NormalizedJob | null {
  const externalId = data.jobSeqNo ? String(data.jobSeqNo) : '';
  if (!externalId || !data.title) return null;

  const posted = data.dateCreated ?? data.postedDate;
  const postedAt = posted ? new Date(posted) : undefined;
  const terms = employmentTermsFrom([data.hiringType, data.type]);
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

  return {
    externalId,
    title: data.title,
    location: data.cityState ?? ([data.city, data.state].filter(Boolean).join(', ') || undefined),
    country: data.country,
    contract: terms,
    workingTime: terms,
    city: data.city,
    region: data.state,
    // CareerConnect livre les coordonnées : ces lignes ne passent pas par le géocodage.
    latitude: num(data.latitude),
    longitude: num(data.longitude),
    description: htmlToPlainText(data.descriptionTeaser),
    department: data.category,
    /**
     * L'URL publique EXIGE le préfixe de locale du portail.
     *
     * Mesuré sur 19 offres Hugo Boss : `/job/<id>/<slug>` rend HTTP 200 et redirige SILENCIEUSEMENT vers
     * `/global/en` — le candidat qui clique « Postuler » atterrit sur une recherche générique. La forme qui
     * sert la fiche est `/<locale>/job/<jobId>/<slug>`, vérifiée sur les deux tenants
     * (`/global/en/job/144427/x` et `/fr/fr/job/JR119278/…` portent bien leur identifiant).
     *
     * Sans locale déclarée on ne fabrique RIEN : une destination fausse est pire qu'une absente, et un `200`
     * qui redirige ne se distingue d'une vraie fiche qu'en cherchant l'identifiant dans la page.
     */
    url: options.localePath
      ? `${origin}/${options.localePath.replace(/^\/|\/$/g, '')}/job/${data.jobId ?? externalId}/${slugify(data.title)}`
      : '',
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: data as unknown as Record<string, unknown>,
  };
}

/**
 * La collecte CareerConnect : `POST /widgets`, pagination par `from`.
 *
 * Elle porte la MÊME preuve d'énumération que le dialecte historique — compteur de l'éditeur, identifiants
 * observés page par page, terminaison nommée. Sans cela une source ne peut pas attester une absence (P7), et
 * un dialecte qui collecte sans prouver serait un recul déguisé en ajout.
 */
async function fetchCareerConnectJobs(origin: string, localePath?: string): Promise<AdapterResult> {
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  const issues = new Set<string>();
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  const size = 100;
  let declaredTotal: number | undefined;
  let pages = 0, rawCount = 0, repeatedIds = 0, termination = 'PAGE_BUDGET_EXHAUSTED';

  /**
   * Le curseur avance de ce que la page a RÉELLEMENT rendu, jamais de `size`.
   *
   * Mesuré sur Hugo Boss : à `from=700` l'API rend 84 lignes pour `size=100`, et certaines pages
   * intermédiaires en rendent moins que demandé. Avancer de `size` sautait donc des offres — 647 collectées
   * sur 784 annoncées, sans qu'aucune erreur ne soit levée. Un décalage de curseur ne se voit pas : il se
   * mesure au compteur de l'éditeur, et c'est ce que `complete=false` a signalé.
   */
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const request = careerConnectRequest(origin, { from, size });
    const response = await fetchJson<{ refineSearch?: { totalHits?: number; data?: { jobs?: CareerConnectJob[] } } }>(
      request.url,
      { method: request.method, headers: { ...HEADERS, 'content-type': 'application/json' }, body: JSON.stringify(request.body) },
    );

    const refine = response.refineSearch ?? {};
    if (typeof refine.totalHits === 'number') declaredTotal = refine.totalHits;
    const batch = refine.data?.jobs ?? [];
    pages++; rawCount += batch.length;
    const pageIds: string[] = [];

    for (const entry of batch) {
      const job = parseCareerConnectJob(entry, origin, { localePath });
      if (!job) continue;
      pageIds.push(job.externalId);
      // Un identifiant déjà vu est COMPTÉ et nommé, jamais écrasé en silence : c'est ce compte qui refuse la
      // preuve d'exhaustivité quand la pagination est instable.
      if (seen.has(job.externalId)) { repeatedIds++; continue; }
      seen.add(job.externalId);
      jobs.push(job);
    }
    pageEvidence.push({ url: request.url, checkedAt: new Date().toISOString(), offset: from,
      sha256: createHash('sha256').update(JSON.stringify(batch)).digest('hex'),
      ids: pageIds, pagination: { start: from, end: from + batch.length, total: declaredTotal ?? -1 },
      publisherCounter: `totalHits=${declaredTotal ?? -1}`,
      componentCounters: [`returned=${batch.length}`, `unique=${pageIds.length}`] });

    from += batch.length;
    if (batch.length === 0) { termination = 'EMPTY_PAGE'; break; }
    if (declaredTotal != null && seen.size >= declaredTotal) { termination = 'ANNOUNCED_TOTAL_REACHED'; break; }
  }

  /**
   * La description complète, une fiche à la fois, sous la porte par hôte partagée.
   *
   * Le pool est BORNÉ à la concurrence de détail commune : ce chemin ajoute une requête par offre, et un
   * portail qui sert 1 500 annonces ne doit pas recevoir 1 500 requêtes simultanées — la politesse par
   * tenant (D25, P8) prime sur la vitesse d'enrichissement.
   */
  if (localePath && jobs.length) {
    const limit = pLimit(DEFAULT_DETAIL_CONCURRENCY);
    const enriched = await Promise.all(jobs.map((job) => limit(async () => {
      if (!job.url) return job;
      try {
        const expectedId = String((job.raw as CareerConnectJob | undefined)?.jobId ?? '');
        return expectedId ? enrichFromJobPosting(job, await fetchText(job.url, { headers: HEADERS }), expectedId) : job;
      } catch { return job; } // Une fiche illisible garde son teaser : jamais d'offre perdue pour un détail.
    })));
    jobs.length = 0; jobs.push(...enriched);
  }

  if (repeatedIds > 0) issues.add('REPEATED_IDS_ACROSS_PAGES');
  const complete = declaredTotal != null && seen.size >= declaredTotal && issues.size === 0;
  if (!complete) issues.add('ENUMERATION_NOT_PROVEN');

  return {
    jobs, complete,
    truncated: termination === 'PAGE_BUDGET_EXHAUSTED',
    enumeration: {
      method: 'PUBLISHER_TOTAL_HITS_WIDGETS', endpoint: `${origin}/widgets`,
      pages, rawCount, termination, issues: [...issues],
      scopes: [{ scope: 'global', declaredTotal: declaredTotal ?? -1, uniqueIds: seen.size, pages, complete }],
      pageEvidence,
    },
  };
}

/**
 * LA DESCRIPTION COMPLÈTE, depuis le JSON-LD de la fiche publique.
 *
 * Le listing CareerConnect ne livre qu'un `descriptionTeaser` : médiane **313** caractères chez Hugo Boss et
 * **287** chez Skechers, plafonnée à ~418 — contre **4 619** pour `foot-locker-france`, sur la MÊME famille
 * Phenom. Ce plafond signe une troncature d'API, pas des annonces courtes.
 *
 * La fiche publique porte un `JobPosting` en JSON-LD : un **standard public observé**, jamais un endpoint
 * deviné. On réutilise `extractJobPostings` du connecteur générique plutôt que d'écrire un second analyseur —
 * deux implémentations du même format finiraient par diverger.
 *
 * Trois refus, et c'est là que réside la sûreté :
 *   · l'identifiant du JSON-LD doit CONCORDER avec l'offre — sans quoi une redirection silencieuse collerait
 *     la description d'une autre offre, exactement le défaut que le gabarit d'URL a déjà produit ;
 *   · pas de JSON-LD ⇒ on garde le teaser, on n'invente rien ;
 *   · plus court que ce qu'on a ⇒ on garde l'existant, un enrichissement ne régresse pas.
 */
export function enrichFromJobPosting(job: NormalizedJob, html: string, expectedId: string): NormalizedJob {
  let postings: ReturnType<typeof extractJobPostings>;
  try { postings = extractJobPostings(html); } catch { return job; }

  for (const node of postings) {
    const raw = (node as Record<string, unknown>).identifier;
    const value = raw && typeof raw === 'object' ? String((raw as Record<string, unknown>).value ?? '') : String(raw ?? '');
    // La concordance d'identifiant est la garde : elle prouve qu'on lit la fiche de CETTE offre.
    if (!value || !expectedId || value !== expectedId) continue;
    const description = htmlToPlainText(String((node as Record<string, unknown>).description ?? '')) ?? '';
    if (description.length <= (job.description?.length ?? 0)) return job;
    return { ...job, description };
  }
  return job;
}
