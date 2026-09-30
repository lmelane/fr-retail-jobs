import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { captureObservedAt, CaptureUnavailableError, OfflineReplayError } from '../../capture/context.js';
import { detailRetryAllowed, waitBeforeDetailRetry } from '../../lib/detailRetry.js';
import { DEFAULT_DETAIL_CONCURRENCY, fetchJson, fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import { assertPipelineRunning } from '../../lib/pipelinePause.js';
import { assertSourceRunning, sourceDeadlineReached } from '../../lib/sourceBudget.js';
import { enumerationComplete } from '../enumerationIssues.js';
import { extractJobPostings } from '../../connectors/generic/jsonLdSitemap.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * MARC O'POLO — lecteur dédié du site carrière maison `company.marc-o-polo.com` (D-485, 30/09/2026).
 *
 * Ce que fait réellement le site, mesuré le 30/09/2026 (preuves : `audits/2026-09-30/marc-o-polo/`) :
 *
 * 1. Le site est une application Nuxt 3. La page « Our Jobs » charge TOUTE la liste en UN appel à l'API publique que le
 *    site déclare lui-même (`window.__NUXT__.config.public.AWS_URL`) : `GET {AWS_URL}/vacancies?language=en`, sans
 *    aucun paramètre de pagination. Le découpage en pages de 15 (`?page=2` … `?page=8`) et les filtres sont faits dans
 *    le navigateur, sur ce tableau (`KC=15`, `e.slice((n-1)*KC, n*KC)` dans le code du site). Le compteur affiché
 *    « N Positions » est la longueur de ce même tableau, filtré par les paramètres de l'adresse.
 * 2. Les variantes observées le 30/09 à 07:25 (« 10 Positions » sur `?page=1`, « 27 Positions » et aucune offre sur
 *    `?page=4`) sont des pages FILTRÉES d'autres visiteurs, servies par le cache : CloudFront garde la page 600 s avec
 *    une clé qui ne contient que `page`, mais transmet au serveur tous les paramètres. Prouvé le 30/09 à 09:14 : une
 *    requête `?page=4&utm_source=mesure` est un « Hit » d'âge 73 s, octet pour octet la page `?page=4` ; la page
 *    `?page=1` servie à 09:12 portait les filtres `career`, `country`, `department`, `region` d'un autre visiteur et
 *    affichait « 15 Positions ». Le compteur et les liens rendus ne sont donc PAS une énumération fiable.
 * 3. La page porte aussi, dans sa charge `__NUXT_DATA__`, la réponse brute de l'API (`$job-list`) : elle n'est jamais
 *    filtrée (la page empoisonnée de 09:12 affichait 15 et embarquait 116 offres). C'est elle qui sert de témoin.
 * 4. La fiche : `GET {AWS_URL}/vacancies/{id}?language=en`, la même réponse que la page d'offre embarque. Une offre
 *    fermée ou inconnue répond HTTP 200 `{}` (mesuré sur 2026-4212, fermée entre 06:45 et 09:12, et sur un
 *    identifiant inventé). La langue de l'API ne traduit que les libellés (pays, contrat) : `en` et `de` rendent les
 *    mêmes 116 identifiants ; la description est dans la langue de l'annonce (`language`).
 *
 * LA PREUVE DE FIN DE LISTE. L'API rend la liste entière en une réponse (`FULL_RESPONSE`), et le lecteur le vérifie à
 * chaque collecte contre la page que le site publie : l'API interrogée doit être celle que la page déclare, et chaque
 * offre embarquée par la page doit figurer dans la réponse de l'API — ou être fermée chez l'éditeur (fiche `{}`), la
 * page pouvant avoir jusqu'à quinze minutes de retard (cache CloudFront de 600 s, puis cache serveur de 5 min). Une
 * offre que la page publie, que l'API ne liste pas et dont la fiche est vivante réfute la preuve.
 *
 * L'IDENTITÉ reste celle du lecteur générique que ce lecteur remplace : `sha1` de l'adresse de la fiche, construite
 * comme le site construit ses liens (`getUrl()` : titre de la liste, `\W` → espace, blancs → `-`, minuscules, puis
 * l'identifiant). Mesuré le 30/09 : 49 des 55 publications actives en base retrouvent ainsi leur identifiant ; les
 * autres ont changé d'intitulé chez l'éditeur (2) ou sont fermées (4) (`audits/2026-09-30/marc-o-polo/scripts/
 * publications-retrouvees.mts`).
 *
 * L'EMPLOYEUR : l'API n'en publie aucun. D-489 (CEO, 30/09) : à chaque collecte, le lecteur lit des pages d'offre du
 * site et applique à toutes les offres le nom qu'elles déclarent (voir `EmployerStatement`). Sans ce nom, l'offre
 * passerait par le portail certifié (`Source.portalScope`, NULL le 30/09) et serait refusée pour identité ; le nom lu
 * rattache à la société déjà liée aux 55 offres en ligne (`audits/2026-09-30/marc-o-polo/scripts/identite-employeur.mts`).
 */

export const MARC_O_POLO_READER = 'marc-o-polo-vacancies';
const RAW_SOURCE = 'marc-o-polo-vacancies-v1';
const ORIGIN = 'https://company.marc-o-polo.com';
/** Les routes de la liste par langue, telles que le site les déclare (`CAREER_PAGE`). */
const CAREER_PAGE = { en: 'career/start-creating-with-us/our-jobs', de: 'karriere/start-creating-with-us/unsere-jobs' } as const;
type Language = keyof typeof CAREER_PAGE;
/** Un identifiant d'offre : l'année puis un numéro (`2026-4345`), la forme que le site extrait de ses adresses. */
const VACANCY_ID = /^\d{4}-\d{4}$/;
/** Une API Gateway AWS, étape comprise : la seule forme d'API que le site déclare. */
const API_URL = /^https:\/\/[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com\/[A-Za-z0-9_-]+$/;
/**
 * Les pays que le site convertit lui-même en code ISO (`Tx`, code du site du 28/09/2026) ; les autres restent le
 * libellé anglais de l'API, que la normalisation reconnaît (Switzerland, Denmark). « Czech Rep. » ne l'est pas : le
 * code du site le nomme `CZ`.
 */
const PUBLISHER_COUNTRY_CODES: Readonly<Record<number, string>> = { 29: 'DE', 153: 'PL', 74: 'ES', 161: 'RO', 103: 'IT', 40: 'BE', 91: 'NL', 79: 'FR', 160: 'CZ', 175: 'SE' };
/** Au-delà, la page et l'API ne décrivent plus le même état : on ne relit pas chaque écart, on réfute. */
const MAX_PAGE_ONLY_CHECKS = 20;

export type MarcOPoloSettings = { startUrl: string; apiUrl: string; language: Language };
type Row = Record<string, unknown> & { id: string };
/**
 * L'EMPLOYEUR DÉCLARÉ PAR LE SITE (D-489, 30/09/2026). L'API ne nomme aucun employeur ; chaque page d'offre du site le
 * déclare dans son JSON-LD (`hiringOrganization.name`, une constante du code du site : « Marc O’Polo »), le nom que le
 * lecteur générique lisait et qui rattache les offres en ligne. À chaque collecte, les pages des deux premières offres
 * lues sont relues ; elles doivent être les pages de ces offres (même intitulé) et déclarer le MÊME nom, appliqué alors
 * à toutes les offres. Sinon, aucun nom par défaut : le motif est retenu, et les offres restent refusées pour identité.
 * Deux pages, et non une : un nom recoupé, et deux adresses sœurs, que le périmètre d'accès déclare par leur répertoire
 * (une seule adresse exacte changerait chaque jour et sortirait du périmètre).
 */
export type EmployerStatement = { name?: string; problem?: string; pages: Array<{ url: string; sha256?: string; problem?: string }> };
const EMPLOYER_PAGES = 2;
const EMPLOYER_RULE = 'SITE_JOBPOSTING_EMPLOYER_APPLIED_TO_LISTING';
type RetainedVacancy = { source: typeof RAW_SOURCE; language: Language; pageUrl: string; listing: Row; detail: Record<string, unknown>;
  employer: EmployerStatement };

/** Le nom déclaré par une page d'offre du site, si elle est bien la page de l'offre attendue. */
export function readEmployerFromJobPage(html: string, expectedTitle: string): { name: string } | { problem: string } {
  let postings: ReturnType<typeof extractJobPostings>;
  try { postings = extractJobPostings(html); } catch { return { problem: 'EMPLOYER_PAGE_UNREADABLE' }; }
  if (postings.length !== 1) return { problem: postings.length ? 'EMPLOYER_PAGE_SEVERAL_POSTINGS' : 'EMPLOYER_PAGE_WITHOUT_JOBPOSTING' };
  const posting = postings[0];
  if (!text(expectedTitle) || text(posting.title) !== text(expectedTitle)) return { problem: 'EMPLOYER_PAGE_OTHER_POSTING' };
  const name = isRecord(posting.hiringOrganization) ? text(posting.hiringOrganization.name) : '';
  return name ? { name } : { problem: 'EMPLOYER_NOT_DECLARED' };
}

/** Le nom retenu, relu du RAW : seulement s'il vient de pages d'offre du site, toutes lues, sans motif. */
function retainedEmployerName(value: unknown, language: Language): string | undefined {
  if (!isRecord(value) || value.problem !== undefined || typeof value.name !== 'string' || !text(value.name)) return undefined;
  const prefix = `${ORIGIN}/${language}/${CAREER_PAGE[language]}/`;
  const pages = value.pages;
  if (!Array.isArray(pages) || !pages.length || pages.length > EMPLOYER_PAGES) return undefined;
  const valid = pages.every((page) => isRecord(page) && typeof page.url === 'string' && page.url.startsWith(prefix) && /-\d{4}-\d{4}$/.test(page.url)
    && typeof page.sha256 === 'string' && /^[0-9a-f]{64}$/.test(page.sha256) && page.problem === undefined);
  return valid ? text(value.name) : undefined;
}

/** La configuration relue : la page de la liste d'une langue connue et l'API que le site déclare. Rien d'autre n'est lu. */
export function marcOPoloSettings(config: Record<string, unknown>): MarcOPoloSettings {
  const language = (Object.keys(CAREER_PAGE) as Language[]).find((lang) => config.startUrl === `${ORIGIN}/${lang}/${CAREER_PAGE[lang]}`);
  if (!language) throw new Error('MARC_O_POLO_INVALID_CONFIG: startUrl doit être la page de la liste en/de');
  if (typeof config.apiUrl !== 'string' || !API_URL.test(config.apiUrl)) throw new Error('MARC_O_POLO_INVALID_CONFIG: apiUrl');
  return { startUrl: config.startUrl as string, apiUrl: config.apiUrl, language };
}

/** L'adresse publique d'une offre, construite comme le site construit ses liens (`getUrl()`, `\W` au sens ASCII de JS). */
export function vacancyPageUrl(language: Language, title: string, id: string): string {
  // `toLowerCase` et non `toLocaleLowerCase` du site : après `\W`, le texte n'est plus qu'ASCII, et le résultat ne doit
  // pas dépendre de la langue du processus (un « I » turc).
  const slug = title.replace(/\W/g, ' ').replace(/\s{1,5}/g, '-').toLowerCase();
  return `${ORIGIN}/${language}/${CAREER_PAGE[language]}/${slug}-${id}`;
}

export const vacancyExternalId = (pageUrl: string) => createHash('sha1').update(pageUrl).digest('hex');

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/**
 * La charge `__NUXT_DATA__` d'une page Nuxt 3 (format `devalue` : un tableau dont les valeurs se référencent par
 * indice). On ne réhydrate que le chemin demandé, jamais le reste de la page (contenus CMS, dates, ensembles) : une
 * étiquette inconnue SUR ce chemin est une erreur, pas une valeur devinée.
 */
export function nuxtPayloadValue(html: string, key: string): unknown {
  const match = /<script\b[^>]*\bid="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error('NUXT_PAYLOAD_MISSING');
  const values: unknown = JSON.parse(match[1]);
  if (!Array.isArray(values) || !values.length) throw new Error('NUXT_PAYLOAD_INVALID');
  const WRAPPERS = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef']);
  const at = (index: unknown): unknown => {
    if (!Number.isSafeInteger(index) || (index as number) < 0 || (index as number) >= values.length) throw new Error('NUXT_PAYLOAD_INDEX');
    return values[index as number];
  };
  /** Déballe les enveloppes réactives d'une valeur, sans descendre dans ses propriétés. */
  const unwrap = (index: unknown, depth = 0): unknown => {
    const value = at(index);
    if (Array.isArray(value) && typeof value[0] === 'string' && WRAPPERS.has(value[0]) && value.length === 2 && depth < 8) return unwrap(value[1], depth + 1);
    return value;
  };
  const hydrate = (index: unknown, depth: number): unknown => {
    if (index === -1) return undefined;
    if (depth > 32) throw new Error('NUXT_PAYLOAD_DEPTH');
    const value = at(index);
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      if (typeof value[0] === 'string') {
        if (WRAPPERS.has(value[0]) && value.length === 2) return hydrate(value[1], depth + 1);
        throw new Error(`NUXT_PAYLOAD_TAG:${value[0].slice(0, 40)}`);
      }
      return value.map((item) => hydrate(item, depth + 1));
    }
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, hydrate(item, depth + 1)]));
  };
  // Seule la clé demandée est réhydratée : le reste de la page (contenus CMS, ensembles, dates) n'est jamais lu.
  const root = unwrap(0);
  if (!isRecord(root) || !Object.hasOwn(root, key)) throw new Error('NUXT_PAYLOAD_KEY_MISSING');
  return hydrate(root[key], 1);
}

export type PublishedList = { declaredApiUrl?: string; counter?: number; ids?: string[]; problem?: string };

/**
 * Ce que la page de la liste PUBLIE : l'API qu'elle déclare, le compteur qu'elle affiche, et la liste brute qu'elle
 * embarque (`$job-list`). Le compteur peut être celui d'une page filtrée servie par le cache (voir en tête) ; il est
 * rendu tel quel, jamais corrigé.
 */
export function readPublishedList(html: string): PublishedList {
  const declaredApiUrl = /\bAWS_URL:"(https:\/\/[^"\\]{1,200})"/.exec(html)?.[1];
  const shown = /class="job-filters__count"[^>]*>\s*(\d{1,6})\b/.exec(html)?.[1];
  const counter = shown === undefined ? undefined : Number(shown);
  let list: unknown;
  try { list = nuxtPayloadValue(html, '$job-list'); } catch (error) { return { declaredApiUrl, counter, problem: (error as Error).message }; }
  const rows = isRecord(list) ? list.data : undefined;
  if (!Array.isArray(rows)) return { declaredApiUrl, counter, problem: isRecord(list) && list.error !== undefined ? 'PAGE_LIST_ERROR' : 'PAGE_LIST_MISSING' };
  const ids = rows.map((row) => (isRecord(row) && typeof row.id === 'string' && VACANCY_ID.test(row.id) ? row.id : null));
  if (ids.some((id) => id === null)) return { declaredApiUrl, counter, problem: 'PAGE_LIST_ROW_INVALID' };
  return { declaredApiUrl, counter, ids: ids as string[] };
}

/** Collecte et reprise du RAW retenu passent par cette seule lecture. Rend `null` pour tout RAW qui n'est pas le sien. */
export function readMarcOPoloRaw(value: unknown): NormalizedJob | null {
  if (!isRecord(value)) return null;
  const raw = value as Partial<RetainedVacancy>;
  const language = raw.language;
  if (raw.source !== RAW_SOURCE || (language !== 'en' && language !== 'de') || !isRecord(raw.listing) || !isRecord(raw.detail)) return null;
  const { listing, detail } = raw as RetainedVacancy;
  const listedTitle = text(listing.title);
  if (typeof listing.id !== 'string' || !VACANCY_ID.test(listing.id) || detail.id !== listing.id || !listedTitle) return null;
  // L'adresse vient du titre de la LISTE, comme le lien du site ; une adresse retenue qui ne la reproduit pas est refusée.
  const pageUrl = vacancyPageUrl(language, listing.title as string, listing.id);
  if (raw.pageUrl !== pageUrl) return null;
  const title = text(detail.title) || listedTitle;
  const description = [detail.whoWeAre, detail.desc1, detail.desc2].map((part) => htmlToPlainText(part)?.trim()).filter(Boolean).join('\n\n');
  const city = text(detail.location);
  const postalCode = text(detail.zipCode);
  const countryLabel = text(detail.country);
  const country = (typeof detail.countryId === 'number' ? PUBLISHER_COUNTRY_CODES[detail.countryId] : undefined) ?? (countryLabel || undefined);
  const published = typeof detail.published === 'number' ? detail.published : listing.published;
  const postedAt = typeof published === 'number' && Number.isFinite(published) ? new Date(published) : undefined;
  const employer = retainedEmployerName(raw.employer, language);
  return {
    externalId: vacancyExternalId(pageUrl),
    title,
    // D-489 : le nom que les pages d'offre du site déclarent, lu à cette collecte ; sans lui, aucun employeur par défaut.
    ...(employer ? { company: employer, employerEvidence: { rawName: employer, path: 'employer.name', rule: EMPLOYER_RULE } } : {}),
    url: pageUrl,
    location: [[postalCode, city].filter(Boolean).join(' '), countryLabel].filter(Boolean).join(', ') || undefined,
    city: city || undefined,
    postalCode: postalCode || undefined,
    region: text(detail.region) || undefined,
    country,
    contract: text(detail.scope) || undefined,
    department: text(detail.department) || undefined,
    language: typeof detail.language === 'string' && /^[a-z]{2}$/.test(detail.language) ? detail.language : undefined,
    description: description || undefined,
    postedAt: postedAt && Number.isFinite(postedAt.getTime()) ? postedAt : undefined,
    raw: value,
  };
}

type DetailOutcome = { detail: Record<string, unknown> } | { failure: 'DETAIL_EMPTY_AT_SOURCE' | 'DETAIL_MALFORMED_IDENTITY' | 'DETAIL_FETCH_FAILED' };

/**
 * Un échec de LECTURE de l'éditeur (statut HTTP, réseau, défi) devient un motif ; une archive absente au rejeu, une
 * capture indisponible, une pause ou un budget épuisé ne sont pas des réponses de l'éditeur et remontent tels quels.
 */
function rethrowUnlessPublisherFailure(error: unknown): void {
  if (error instanceof OfflineReplayError || error instanceof CaptureUnavailableError) throw error;
  assertSourceRunning();
}

async function readDetail(settings: MarcOPoloSettings, id: string): Promise<DetailOutcome> {
  let detail: unknown;
  try { detail = await fetchJson<unknown>(`${settings.apiUrl}/vacancies/${id}?language=${settings.language}`); }
  catch (error) { rethrowUnlessPublisherFailure(error); return { failure: 'DETAIL_FETCH_FAILED' }; }
  if (isRecord(detail) && Object.keys(detail).length === 0) return { failure: 'DETAIL_EMPTY_AT_SOURCE' };
  if (!isRecord(detail) || detail.id !== id) return { failure: 'DETAIL_MALFORMED_IDENTITY' };
  return { detail };
}

/** Les pages d'offre lues pour l'employeur, et le nom qu'elles déclarent toutes, ou le premier motif qui l'interdit. */
async function readSiteEmployer(settings: MarcOPoloSettings, candidates: Array<{ url: string; title: string }>): Promise<EmployerStatement> {
  if (!candidates.length) return { problem: 'EMPLOYER_NO_PAGE_TO_READ', pages: [] };
  const pages: EmployerStatement['pages'] = [];
  const names = new Set<string>();
  for (const candidate of candidates) {
    let html: string;
    try { html = await fetchText(candidate.url); }
    catch (error) { rethrowUnlessPublisherFailure(error); pages.push({ url: candidate.url, problem: 'EMPLOYER_PAGE_FETCH_FAILED' }); continue; }
    const read = readEmployerFromJobPage(html, candidate.title);
    const sha256 = createHash('sha256').update(html).digest('hex');
    if ('problem' in read) pages.push({ url: candidate.url, sha256, problem: read.problem });
    else { pages.push({ url: candidate.url, sha256 }); names.add(read.name); }
  }
  const problem = pages.find((page) => page.problem)?.problem ?? (names.size > 1 ? 'EMPLOYER_PAGES_DISAGREE' : undefined);
  return problem ? { problem, pages } : { name: [...names][0], pages };
}

export async function fetchMarcOPoloJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  assertPipelineRunning();
  const settings = marcOPoloSettings(config);
  const concurrency = Number(config.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > DEFAULT_DETAIL_CONCURRENCY) throw new Error('MARC_O_POLO_INVALID_CONFIG: detailConcurrency');
  const issues: string[] = [];

  // 1. La page que le site publie : l'API qu'elle déclare et la liste brute qu'elle embarque. Illisible, elle ne prouve
  // plus rien mais n'empêche pas de lire les offres.
  let published: PublishedList;
  try { published = readPublishedList(await fetchText(settings.startUrl)); }
  catch (error) { rethrowUnlessPublisherFailure(error); published = { problem: 'PAGE_FETCH_FAILED' }; }
  if (published.problem) issues.push(`PUBLISHED_LIST_UNREADABLE:${published.problem}`);
  // Une page non reçue ne déclare rien : son échec est déjà nommé, il ne devient pas un changement d'API.
  if (published.problem !== 'PAGE_FETCH_FAILED' && published.declaredApiUrl !== settings.apiUrl) issues.push('PUBLISHED_API_URL_CHANGED');

  // 2. La liste entière, en une réponse.
  const endpoint = `${settings.apiUrl}/vacancies?language=${settings.language}`;
  const native = await fetchJson<unknown>(endpoint);
  if (!Array.isArray(native)) throw new Error('MARC_O_POLO_INVALID_LISTING: tableau attendu');
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const rows: Row[] = [];
  const nativeIds: string[] = [];
  const canonicalIds: string[] = [];
  let anonymous = 0;
  for (const row of native) {
    const id = isRecord(row) && typeof row.id === 'string' && VACANCY_ID.test(row.id) ? row.id : null;
    const canonicalId = id && text((row as Row).title) ? vacancyExternalId(vacancyPageUrl(settings.language, (row as Row).title as string, id)) : undefined;
    if (canonicalId) canonicalIds.push(canonicalId); else anonymous++;
    if (id) nativeIds.push(id);
    if (!id) { rejectedRows.push({ reason: 'LISTING_ROW_INVALID_ID', raw: row }); continue; }
    if (!canonicalId) { rejectedRows.push({ reason: 'LISTING_ROW_WITHOUT_TITLE', raw: row }); continue; }
    // Un identifiant répété : la liste se contredit, le périmètre lu n'est plus identifiable (motif d'énumération).
    if (rows.some((seen) => seen.id === id)) { rejectedRows.push({ reason: 'DUPLICATE_LISTING_ID', raw: row, canonicalId }); continue; }
    rows.push(row as Row);
  }

  // 3. La fiche de chaque offre listée, puis UNE relecture différée des fiches en échec (`lib/detailRetry.ts`).
  const limit = pLimit(concurrency);
  const outcomes = await Promise.all(rows.map((row) => limit(() => readDetail(settings, row.id))));
  const failed = outcomes.flatMap((outcome, index) => ('failure' in outcome && outcome.failure !== 'DETAIL_MALFORMED_IDENTITY' ? [index] : []));
  if (detailRetryAllowed(failed.length, rows.length)) {
    await waitBeforeDetailRetry(config);
    for (const index of failed) {
      if (sourceDeadlineReached()) break;
      outcomes[index] = await readDetail(settings, rows[index].id);
    }
  }
  if (rows.length > 0 && outcomes.every((outcome) => 'failure' in outcome && outcome.failure === 'DETAIL_FETCH_FAILED'))
    throw new Error('MARC_O_POLO_DETAILS_UNREACHABLE: aucune fiche lue');

  // 4. L'employeur que le site déclare (D-489) : les pages des deux premières offres lues, dans l'ordre de la liste.
  const employer = await readSiteEmployer(settings, rows.flatMap((row, index) => {
    const outcome = outcomes[index];
    return 'detail' in outcome ? [{ url: vacancyPageUrl(settings.language, row.title as string, row.id), title: String(outcome.detail.title ?? '') }] : [];
  }).slice(0, EMPLOYER_PAGES));

  const jobs: NormalizedJob[] = [];
  rows.forEach((row, index) => {
    const outcome = outcomes[index];
    const pageUrl = vacancyPageUrl(settings.language, row.title as string, row.id);
    const canonicalId = vacancyExternalId(pageUrl);
    if ('failure' in outcome) { rejectedRows.push({ reason: outcome.failure, raw: row, canonicalId }); return; }
    const retained: RetainedVacancy = { source: RAW_SOURCE, language: settings.language, pageUrl, listing: row, detail: outcome.detail, employer };
    const job = readMarcOPoloRaw(retained);
    if (!job) { rejectedRows.push({ reason: 'DETAIL_MALFORMED_IDENTITY', raw: retained, canonicalId }); return; }
    jobs.push(job);
  });

  // 5. Le témoin : chaque offre que la page embarque est listée par l'API, ou fermée chez l'éditeur.
  const listed = new Set(nativeIds);
  const pageOnly = (published.ids ?? []).filter((id) => !listed.has(id));
  const apiOnly = published.ids ? nativeIds.filter((id) => !published.ids!.includes(id)).length : undefined;
  let closedSinceRender = 0;
  if (pageOnly.length > MAX_PAGE_ONLY_CHECKS) issues.push(`PUBLISHED_LIST_DIVERGES:${pageOnly.length}`);
  else {
    for (const id of pageOnly) {
      // Budget épuisé : l'offre n'est pas vérifiée, et le dit — jamais comptée fermée faute de temps.
      if (sourceDeadlineReached()) { issues.push(`PUBLISHED_ONLY_UNVERIFIED:${id}`); continue; }
      const outcome = await readDetail(settings, id);
      if ('detail' in outcome) issues.push(`API_LIST_OMITS_PUBLISHED:${id}`);
      else if (outcome.failure === 'DETAIL_EMPTY_AT_SOURCE') closedSinceRender++;
      else issues.push(`PUBLISHED_ONLY_UNVERIFIED:${id}`);
    }
  }

  const complete = enumerationComplete(true, issues, rejectedRows);
  const sha256 = createHash('sha256').update(JSON.stringify(native)).digest('hex');
  return {
    jobs, rejectedRows, complete, truncated: false,
    // Le total que le site publie : la liste qu'il embarque, jamais le compteur, qui peut être celui d'une page filtrée.
    ...(published.ids ? { declaredTotal: published.ids.length } : {}),
    enumeration: {
      method: 'NATIVE_SITE_VACANCIES_FEED', endpoint, pages: 1, rawCount: native.length, termination: 'FULL_RESPONSE',
      documentation: settings.startUrl, issues, blockers: issues, enumerationTraversalComplete: true,
      // Une ligne sans identifiant ou sans titre ne peut pas être nommée : aucune absence ne peut alors être attestée.
      canonicalAbsenceProofUsable: anonymous === 0,
      pageEvidence: [{ url: endpoint, checkedAt: captureObservedAt().toISOString(), sha256, offset: 0, pagination: null,
        ids: nativeIds, canonicalIds, publisherCounter: `vacancies=${native.length}`,
        componentCounters: [`language=${settings.language}`, `page.jobList=${published.ids?.length ?? 'illisible'}`,
          `page.compteur=${published.counter ?? 'absent'}`, `page.seule=${pageOnly.length}`, `page.seule.fermee=${closedSinceRender}`,
          `api.seule=${apiOnly ?? 'inconnu'}`, `anonymous=${anonymous}`,
          `employeur=${employer.name ?? `absent:${employer.problem}`}`, ...employer.pages.map((page) => `employeur.page=${page.url}`)] }],
    },
  };
}
