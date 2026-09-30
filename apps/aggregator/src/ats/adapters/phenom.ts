import { createHash } from 'node:crypto';
import { captureObservedAt } from '../../capture/context.js';
import pLimit from 'p-limit';
import { fetchJson, fetchText, DEFAULT_DETAIL_CONCURRENCY } from '../../lib/http.js';
import { normalizeLanguage } from '../../normalize/language.js';
import { htmlToPlainText } from '../../lib/html.js';
import { extractJobPostings } from '../../connectors/generic/jsonLdSitemap.js';
import { enrichPostingEvidence } from '../../lib/postingEvidence.js';
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
/** Relectures au plus quand l'ordre instable du serveur a caché des offres (Hugo Boss, Skechers, 29/09/2026). */
const RECONCILIATION_PASSES = 3;

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


/**
 * L'identifiant CANONIQUE d'une entrée `/api/jobs` : le chemin d'identité de `externalId`, arrêté avant le
 * repli sur le titre. Un titre n'est pas un identifiant natif — deux postes homonymes le partagent, et il
 * change quand l'éditeur réécrit l'intitulé. Une ligne qu'aucun `slug` ni `req_id` ne nomme est ANONYME :
 * elle est comptée, jamais inventée (modèle Ashby).
 */
function phenomCanonicalId(data: PhenomJobData): string | null {
  const id = data.slug ?? data.req_id;
  return typeof id === 'string' && id.trim() ? id : null;
}

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
    // `language` était lu pour COMPTER les variantes de requisition, jamais
    // écrit dans l'offre : l'information était captée puis perdue.
    language: normalizeLanguage(data.language),
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
    return fetchCareerConnectJobs(origin, careerConnectOptions(config));
  }

  const jobs: NormalizedJob[] = [];
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const seen = new Set<string>();
  let declaredTotal: number | undefined;
  const issues = new Set<string>();
  let pages = 0, rawCount = 0, withoutData = 0, repeatedIds = 0, languageVariants = 0, termination = 'PAGE_BUDGET_EXHAUSTED';
  /** Lignes servies qu'aucun `slug` ni `req_id` ne nomme : aucun identifiant historique ne peut être déclaré absent. */
  let anonymousRows = 0;
  const languageOf = new Map<string, string>();
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${origin}/api/jobs?limit=${PAGE_SIZE}&page=${page}`;
    const response = await fetchJson<PhenomResponse>(url, { headers: HEADERS });

    const batch = response.jobs ?? [];
    pages++; rawCount += batch.length;
    let fresh = 0;
    const pageIds: string[] = [];
    /**
     * LE CONTRAT DES IDENTIFIANTS CANONIQUES, page par page.
     *
     * Ce sont les identifiants natifs RÉELLEMENT observés dans la réponse — le même chemin d'identité que
     * `externalId`, sans le repli sur le titre. Sans eux la source ne prouve aucune absence ; avec un
     * identifiant fabriqué elle en prouverait une FAUSSE, ce qui est pire.
     */
    const pageCanonicalIds: string[] = [];

    for (const entry of batch) {
      // Une entrée sans `data` ne porte aucun identifiant lisible : elle est vue, comptée, et jamais nommée.
      if (!entry.data) { withoutData++; anonymousRows++; continue; }
      const canonicalId = phenomCanonicalId(entry.data);
      if (canonicalId) pageCanonicalIds.push(canonicalId); else anonymousRows++;
      const job = parsePhenomJob(entry.data, origin, config);
      /**
       * Une ligne VUE puis écartée faute de titre est une DISPOSITION nommée, jamais un trou silencieux : sans
       * elle, son identifiant canonique resterait observé sans offre ni motif, et le contrat tomberait à juste
       * titre. Elle ne portait aucun nom avant ce lot — la ligne disparaissait du décompte.
       */
      if (!job) { rejectedRows.push({ reason: 'MISSING_TITLE', raw: entry.data, ...(canonicalId ? { canonicalId } : {}) }); continue; }
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
    pageEvidence.push({ url, checkedAt: captureObservedAt().toISOString(), sha256: createHash('sha256').update(JSON.stringify(response)).digest('hex'), offset: (page - 1) * PAGE_SIZE, pagination: null,
      ids: pageIds, canonicalIds: pageCanonicalIds, publisherCounter: pageTotal === undefined ? '' : `total=${pageTotal}`, componentCounters: [`entries=${batch.length}`, `languageVariants=${languageVariants}`, `uniqueIds=${seen.size}`, `repeated=${repeatedIds}`, `withoutData=${withoutData}`, `anonymous=${anonymousRows}`] });

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
  return { jobs, declaredTotal, complete, rejectedRows, truncated: termination === 'PAGE_BUDGET_EXHAUSTED' || (declaredTotal !== undefined && jobs.length + languageVariants < declaredTotal),
    enumeration: { method: 'PUBLISHER_TOTAL_COUNT_JSON_PAGINATION', endpoint: `${origin}/api/jobs`, pages, rawCount, termination, issues: [...issues],
      // Une ligne vue sans `slug` ni `req_id` ne peut pas être nommée : aucun identifiant historique ne peut alors être déclaré absent.
      canonicalAbsenceProofUsable: anonymousRows === 0,
      pageEvidence, scopes: [{ scope: 'jobs', declaredTotal: declaredTotal ?? -1, uniqueIds: jobs.length, pages, complete }, { scope: 'languageVariants', declaredTotal: languageVariants, uniqueIds: languageVariants, pages, complete: true }, { scope: 'entriesWithoutData', declaredTotal: withoutData, uniqueIds: withoutData, pages, complete: true }] } };
}

/**
 * Coordinates Phenom already provides, so these rows skip geocoding entirely.
 * Returns null when the payload has none.
 */
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
 * Les réglages d'un portail CareerConnect, lus de la configuration : les MÊMES pour la collecte et pour la relecture
 * hors réseau du RAW retenu, pour qu'elles ne puissent pas diverger.
 *
 * `widgetsLang` / `widgetsCountry` — l'index que le site interroge lui-même (PVH, 30/09/2026). Par défaut
 * `en` / `global`, comme avant. Mais chez PVH l'index `global` est un index FIGÉ : 1 644 offres, toutes datées de
 * mars 2024, identifiants `PVH1US…WDINTERNAL…` ; le site `/us/en` interroge `en_us` / `us` (valeurs de sa propre
 * page de recherche) et sert 1 574 offres courantes, identifiants `PCAPCAUS…` — la famille de son plan de site.
 * La valeur se relit sur la page du site, elle ne se devine pas.
 *
 * `brandField` — le champ de l'offre qui porte la marque publiée par l'éditeur (PVH : `brand`, affiché « Company »
 * sur le site : Tommy Hilfiger, Calvin Klein, ou PVH pour les postes du groupe). Opt-in par source, comme
 * `brandTag` pour le dialecte Foot Locker.
 */
export type CareerConnectOptions = { localePath?: string; lang: string; country: string; brandField?: string };
export function careerConnectOptions(config: Record<string, unknown>): CareerConnectOptions {
  const text = (key: string) => typeof config[key] === 'string' && (config[key] as string).trim() ? (config[key] as string).trim() : undefined;
  const lang = text('widgetsLang') ?? 'en', country = text('widgetsCountry') ?? 'global', brandField = text('brandField');
  if (!/^[a-z]{2}(?:_[a-z]{2})?$/i.test(lang) || !/^(?:[a-z]{2}|global)$/i.test(country) || (brandField !== undefined && !/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(brandField)))
    throw new Error('phenom: réglages CareerConnect invalides (widgetsLang, widgetsCountry, brandField)');
  return { localePath: typeof config.localePath === 'string' ? config.localePath : undefined, lang, country, ...(brandField ? { brandField } : {}) };
}

/**
 * La requête CareerConnect. `country: 'global'` est demandé par défaut : mesuré sur Skechers, le backend rend
 * 1 656 offres que la locale soit `fr/France` ou `en/global`. Un portail dont l'index `global` n'est pas celui du
 * site déclare le sien (`widgetsLang`, `widgetsCountry` : PVH). Le champ de marque configuré est demandé en facette :
 * son décompte par valeur est la preuve de l'attribution.
 */
export function careerConnectRequest(origin: string, page: { from: number; size: number },
  options: Pick<CareerConnectOptions, 'lang' | 'country' | 'brandField'> = { lang: 'en', country: 'global' }): {
  url: string; method: 'POST'; body: Record<string, unknown>;
} {
  return {
    url: `${origin}/widgets`,
    method: 'POST',
    body: {
      lang: options.lang, deviceType: 'desktop', country: options.country, pageName: 'search-results',
      ddoKey: 'refineSearch', jdsource: 'facets', isSliderEnable: false,
      jobs: true, counts: true, all_fields: ['category', 'country', 'state', 'city', ...(options.brandField ? [options.brandField] : [])],
      from: page.from, size: page.size,
    },
  };
}

/** Une offre du dialecte CareerConnect. Les champs sont ceux réellement servis (fixture Hugo Boss, 2026-09-14). */
export type CareerConnectJob = {
  jobSeqNo?: string; jobId?: string | number; title?: string; category?: string;
  companyName?: string;
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
  options: { localePath?: string; brandField?: string } = {},
): NormalizedJob | null {
  const externalId = data.jobSeqNo ? String(data.jobSeqNo) : '';
  if (!externalId || !data.title) return null;

  const posted = data.dateCreated ?? data.postedDate;
  const postedAt = posted ? new Date(posted) : undefined;
  const terms = employmentTermsFrom([data.hiringType, data.type]);
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  /**
   * La marque que l'éditeur publie sur l'offre, quand la source déclare son champ (PVH, 30/09/2026 : `brand`, le filtre
   * « Company » du site). Elle passe avant l'entité juridique, comme la propriété de marque configurée de SuccessFactors :
   * un candidat postule chez Calvin Klein, pas chez « PVH France SAS ». Une offre sans valeur garde l'employeur natif.
   */
  const brandValue = options.brandField ? (data as Record<string, unknown>)[options.brandField] : undefined;
  const brand = typeof brandValue === 'string' && brandValue.trim() ? brandValue.trim() : undefined;
  const companyName = typeof data.companyName === 'string' && data.companyName.trim() ? data.companyName.trim() : undefined;

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
    // Native per-publication employer, also present in the detail JobPosting.
    // Keep legal entities verbatim; never replace them with the registry label.
    ...(brand ? {
      company: brand,
      employerEvidence: { rawName: brand, path: `listing.${options.brandField}`, rule: 'CONFIGURED_BRAND_PROPERTY' },
    } : companyName ? {
      company: companyName,
      employerEvidence: { rawName: companyName, path: 'companyName', rule: 'EXPLICIT_JOBPOSTING_EMPLOYER' },
    } : {}),
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
async function fetchCareerConnectJobs(origin: string, options: CareerConnectOptions): Promise<AdapterResult> {
  const { localePath, brandField } = options;
  /** Le décompte par marque que l'éditeur annonce (facette du champ configuré), lu sur la première page. */
  let brandFacet: Record<string, number> | undefined;
  const jobs: NormalizedJob[] = [];
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const seen = new Set<string>();
  const issues = new Set<string>();
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  // 500, le maximum servi par /widgets. À 100 l'ordre du serveur est instable : Hugo Boss 775 lignes pour 546
  // identifiants au RUN du 29/09 (≈ 610 en relecture) ; à 500, 710 puis 775 sur deux relectures du même soir.
  const size = 500;
  let declaredTotal: number | undefined;
  let pages = 0, rawCount = 0, repeatedIds = 0, anonymousRows = 0, termination = 'PAGE_BUDGET_EXHAUSTED';

  /**
   * Le curseur avance de ce que la page a RÉELLEMENT rendu, jamais de `size`.
   *
   * Mesuré sur Hugo Boss : à `from=700` l'API rend 84 lignes pour `size=100`, et certaines pages
   * intermédiaires en rendent moins que demandé. Avancer de `size` sautait donc des offres — 647 collectées
   * sur 784 annoncées, sans qu'aucune erreur ne soit levée. Un décalage de curseur ne se voit pas : il se
   * mesure au compteur de l'éditeur, et c'est ce que `complete=false` a signalé.
   */
  const rejectedIds = new Set<string>();
  /**
   * Une page lue et versée à la preuve. `pass` 1 est la lecture ; au-delà, une relecture de réconciliation, dont
   * les identifiants déjà vus sont attendus (ni comptés comme répétés, ni rejetés deux fois). Rend le nombre de lignes.
   */
  const readAt = async (from: number, pass: number): Promise<number> => {
    const request = careerConnectRequest(origin, { from, size }, options);
    const response = await fetchJson<{ refineSearch?: { totalHits?: number; data?: { jobs?: CareerConnectJob[];
      aggregations?: { field?: unknown; value?: unknown }[] } } }>(
      request.url,
      { method: request.method, headers: { ...HEADERS, 'content-type': 'application/json' }, body: JSON.stringify(request.body) },
    );

    const refine = response.refineSearch ?? {};
    if (pass === 1 && typeof refine.totalHits === 'number') declaredTotal = refine.totalHits;
    if (brandField && pass === 1 && from === 0) {
      const facet = Array.isArray(refine.data?.aggregations) ? refine.data.aggregations.find((a) => a?.field === brandField)?.value : undefined;
      if (facet && typeof facet === 'object' && !Array.isArray(facet) && Object.values(facet).every((n) => Number.isSafeInteger(n) && (n as number) >= 0))
        brandFacet = Object.fromEntries(Object.entries(facet as Record<string, number>).map(([name, n]) => [name.trim(), n]));
    }
    const batch = refine.data?.jobs ?? [];
    pages++; if (pass === 1) rawCount += batch.length;
    const pageIds: string[] = [];
    /**
     * L'identifiant CANONIQUE CareerConnect est `jobSeqNo`, celui que l'éditeur expose et que
     * `parseCareerConnectJob` publie tel quel. Aucun repli : une ligne sans `jobSeqNo` est ANONYME, comptée et
     * rejetée par son motif — jamais nommée par un identifiant fabriqué.
     */
    const pageCanonicalIds: string[] = [];
    let fresh = 0;

    for (const entry of batch) {
      const canonicalId = entry.jobSeqNo ? String(entry.jobSeqNo) : null;
      if (canonicalId) pageCanonicalIds.push(canonicalId); else if (pass === 1) anonymousRows++;
      const job = parseCareerConnectJob(entry, origin, { localePath, brandField });
      // Une ligne écartée porte sa cause et son identifiant quand il existe : sans disposition nommée, son
      // identifiant observé resterait orphelin dans la preuve et le contrat tomberait.
      if (!job) {
        if (pass === 1 || (canonicalId && !rejectedIds.has(canonicalId))) {
          rejectedRows.push({ reason: 'MISSING_JOB_SEQ_NO_OR_TITLE', raw: entry, ...(canonicalId ? { canonicalId } : {}) });
          if (canonicalId) rejectedIds.add(canonicalId);
        }
        continue;
      }
      pageIds.push(job.externalId);
      // Un identifiant déjà vu est COMPTÉ et nommé, jamais écrasé en silence : c'est ce compte qui refuse la
      // preuve d'exhaustivité quand la pagination est instable.
      if (seen.has(job.externalId)) { if (pass === 1) repeatedIds++; continue; }
      seen.add(job.externalId);
      jobs.push(job); fresh++;
    }
    pageEvidence.push({ url: request.url, checkedAt: captureObservedAt().toISOString(), offset: from,
      sha256: createHash('sha256').update(JSON.stringify(batch)).digest('hex'),
      ids: pageIds, canonicalIds: pageCanonicalIds, pagination: { start: from, end: from + batch.length, total: declaredTotal ?? -1 },
      publisherCounter: pass === 1 ? `totalHits=${declaredTotal ?? -1}` : '',
      componentCounters: [`returned=${batch.length}`, `unique=${pageIds.length}`, `anonymous=${anonymousRows}`, ...(pass > 1 ? [`pass=${pass}`, `fresh=${fresh}`] : [])] });
    return batch.length;
  };

  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const returned = await readAt(from, 1);
    from += returned;
    if (returned === 0) { termination = 'EMPTY_PAGE'; break; }
    if (declaredTotal != null && seen.size >= declaredTotal) { termination = 'ANNOUNCED_TOTAL_REACHED'; break; }
  }

  /**
   * Relectures de réconciliation (29/09/2026), sur le modèle de Workday (10/09). Même à 500 par page, l'ordre du
   * serveur bouge d'une page à l'autre : une offre servie deux fois en cache une autre. Quand des identifiants se sont
   * répétés et que l'annoncé n'est pas atteint, le tableau est relu, au plus trois fois ; il n'est prouvé que si
   * l'union des lectures atteint le total annoncé. La répétition reste nommée.
   */
  let reconciled = false;
  if (repeatedIds > 0 && declaredTotal != null && seen.size < declaredTotal && termination !== 'PAGE_BUDGET_EXHAUSTED') {
    for (let pass = 2; pass <= 1 + RECONCILIATION_PASSES && seen.size < declaredTotal; pass++) {
      for (let at = 0, reads = 0; at < declaredTotal && seen.size < declaredTotal && reads < MAX_PAGES; reads++) {
        const returned = await readAt(at, pass);
        if (!returned) break;
        at += returned;
      }
    }
    if (seen.size >= declaredTotal) { reconciled = true; termination = 'SECOND_SWEEP_RECONCILED'; issues.add('RECONCILED_BY_SECOND_SWEEP'); }
  }

  /**
   * LA PREUVE DE L'ATTRIBUTION (PVH, 30/09/2026). Quand la source déclare le champ de marque, l'éditeur en publie aussi
   * le décompte par valeur (facette : Tommy Hilfiger 866, Calvin Klein 579, PVH 129 = 1 574 annoncées). Chaque valeur
   * doit compter exactement autant d'offres lues que l'éditeur en annonce, et aucune offre lue ne peut porter une valeur
   * absente de la facette. Sinon l'attribution n'est pas celle de l'éditeur : le parcours n'est pas prouvé, l'écart
   * est nommé.
   */
  const brandScopes: NonNullable<NonNullable<AdapterResult['enumeration']>['scopes']> = [];
  if (brandField) {
    const read = new Map<string, number>();
    for (const job of jobs) {
      const value = job.employerEvidence?.rule === 'CONFIGURED_BRAND_PROPERTY' ? job.employerEvidence.rawName : '';
      read.set(value, (read.get(value) ?? 0) + 1);
    }
    if (!brandFacet) issues.add('BRAND_FACET_ABSENT');
    else {
      const withoutBrand = read.get('') ?? 0;
      const announced = Object.values(brandFacet).reduce((sum, n) => sum + n, 0);
      for (const [value, count] of Object.entries(brandFacet)) brandScopes.push({ scope: `${brandField}=${value}`, declaredTotal: count, uniqueIds: read.get(value) ?? 0, pages, complete: read.get(value) === count });
      const outside = [...read.keys()].filter((value) => value && !Object.hasOwn(brandFacet!, value));
      // Une valeur lue que la facette n'annonce pas est nommée, avec son décompte.
      for (const value of outside) brandScopes.push({ scope: `${brandField}=${value}`, declaredTotal: 0, uniqueIds: read.get(value)!, pages, complete: false });
      if (withoutBrand) brandScopes.push({ scope: `${brandField}:absent`, declaredTotal: Math.max((declaredTotal ?? 0) - announced, 0), uniqueIds: withoutBrand, pages, complete: withoutBrand === (declaredTotal ?? 0) - announced });
      if (brandScopes.some((scope) => !scope.complete) || outside.length) issues.add('BRAND_FACET_COUNT_MISMATCH');
    }
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
  // Une répétition ne passe que réconciliée ; toute autre cause refuse la preuve.
  const blocking = [...issues].filter((issue) => !(reconciled && (issue === 'REPEATED_IDS_ACROSS_PAGES' || issue === 'RECONCILED_BY_SECOND_SWEEP')));
  const complete = declaredTotal != null && seen.size >= declaredTotal && blocking.length === 0;
  if (!complete) issues.add('ENUMERATION_NOT_PROVEN');

  return {
    jobs, complete, rejectedRows,
    truncated: termination === 'PAGE_BUDGET_EXHAUSTED',
    enumeration: {
      method: 'PUBLISHER_TOTAL_HITS_WIDGETS', endpoint: `${origin}/widgets`,
      pages, rawCount, termination, issues: [...issues],
      // Une ligne servie sans `jobSeqNo` reste innommable : elle interdit de déclarer une absence.
      canonicalAbsenceProofUsable: anonymousRows === 0,
      scopes: [{ scope: 'global', declaredTotal: declaredTotal ?? -1, uniqueIds: seen.size, pages, complete }, ...brandScopes],
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
 *   · pas de JSON-LD, ou plusieurs sur la page ⇒ on garde le teaser, on n'invente rien ;
 *   · une fiche qui se déclare à une autre adresse que l'offre ⇒ on garde le teaser : elle ne serait pas relisible ;
 *   · plus court que ce qu'on a ⇒ on garde l'existant, sans évidence : un enrichissement ne régresse pas.
 *
 * Quand la fiche est admise, son évidence est appliquée et RETENUE dans le RAW (`postingEvidence`, comme
 * DigitalRecruiters et Personio) : le lecteur de récupération relit l'offre depuis ce qui a été observé, hors réseau,
 * au lieu d'un teaser qui ne dit pas ce que le collecteur a publié (lot F3b, Hugo Boss).
 */
export function enrichFromJobPosting(job: NormalizedJob, html: string, expectedId: string): NormalizedJob {
  let postings: ReturnType<typeof extractJobPostings>;
  try { postings = extractJobPostings(html); } catch { return job; }
  if (postings.length !== 1 || !expectedId) return job;
  const node = postings[0] as Record<string, unknown>;
  const raw = node.identifier;
  const value = raw && typeof raw === 'object' ? String((raw as Record<string, unknown>).value ?? '') : String(raw ?? '');
  // La concordance d'identifiant est la garde : elle prouve qu'on lit la fiche de CETTE offre.
  if (!value || value !== expectedId) return job;
  if (node.url != null) { try { if (typeof node.url !== 'string' || new URL(node.url).href !== job.url) return job; } catch { return job; } }
  // Un enrichissement ne régresse pas : une fiche dont le texte est plus court que le teaser ne laisse aucune évidence,
  // et le lecteur, qui relit le RAW tel quel, garde alors le teaser comme le collecteur.
  const enriched = enrichPostingEvidence(job, html);
  return (enriched.description?.length ?? 0) < (job.description?.length ?? 0) ? job : enriched;
}
