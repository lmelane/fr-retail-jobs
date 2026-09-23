import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { fetchText, fetchWithRetry, DEFAULT_DETAIL_CONCURRENCY } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { captureObservedAt } from '../../capture/context.js';
import { extractJobPostings, normalizeJobPosting } from '../../connectors/generic/jsonLdSitemap.js';

/**
 * Taleo Business Edition (TBE) — portails `{pod}.tbe.taleo.net/{pod}02/ats/careers/v2/`.
 *
 * Ce n'est PAS Taleo Enterprise (`careersection/…/jobsearch.ftl` +
 * `/rest/jobboard/searchjobs`) : TBE est l'édition PME d'Oracle, sans API JSON
 * publique — tout est du HTML serveur. Mesuré le 2026-09-06 sur Brown Thomas
 * Arnotts (`org=ARNOTTS`, pod `lde`) :
 *
 * - une organisation publie ses offres dans PLUSIEURS « career websites »
 *   (`cws=60…79` : 17 sections liées depuis le site de marque, une par
 *   magasin ou par métier). Aucune section ne liste tout ; il faut lire chaque
 *   section configurée et dédupliquer sur `rid`, l'identifiant de réquisition ;
 * - la première page rend 10 lignes ; la suite (`?next&rowFrom=10…`) n'existe
 *   QUE dans la session ouverte par la première : sans le cookie `JSESSIONID`
 *   la page suivante répond 200 avec un corps d'un octet. Le cookie est donc
 *   relu sur la première réponse et renvoyé sur les suivantes ;
 * - la liste porte titre, lieu et identifiant ; le texte complet est sur
 *   `viewRequisition?org=…&cws=…&rid=…` (bloc `cwsJobDescription`). Une
 *   réquisition retirée y répond 200 avec « Job Not Available » — sans
 *   description, on garde ce que la liste a donné ;
 * - la liste ne date rien, mais la fiche porte un JSON-LD avec `datePosted`
 *   au format « 2026-08-20 00:00:00.0 » (l2, 2026-09-06 — 68 offres Brown
 *   Thomas affichées avec la date de notre premier passage).
 *
 * Config : `{ origin: 'https://lde.tbe.taleo.net/lde02', org: 'ARNOTTS', cws: [79, 70, 60] }`
 * (`origin` inclut le préfixe de pod ; `cws` accepte un nombre ou une liste).
 */

const PAGE_SIZE = 10;
/** 100 pages × 10 = 1 000 offres par section : au-delà, la section est suspecte. */
const MAX_PAGES = 100;

/** Une ligne de résultat : lien `viewJobLink`, puis deux `<div>` (lieu, id). */
const RESULT_ROW =
  /<a href="([^"]*viewRequisition\?[^"]*rid=(\d+)[^"]*)"[^>]*class="viewJobLink"[^>]*>([^<]{1,200})<\/a>\s*<\/h4>\s*<div[^>]*>([^<]{0,120})<\/div>\s*<div[^>]*>\s*(\d+)\s*<\/div>/gi;

/**
 * Ce qui suit IMMÉDIATEMENT le texte de l'offre dans le gabarit TBE : la
 * feuille de style du partage social, puis la barre Retour/Partager/Postuler.
 * Aucun des deux ne contient de texte d'offre ; c'est la borne de fin.
 */
const DESCRIPTION_END = /<link rel="stylesheet"|oracletaleocwsv2-button-navigation|<footer/i;

function decode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Les offres d'une page de résultats TBE. Exporté pour être testé sans réseau. */
export function parseTaleoListing(html: string): NormalizedJob[] {
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  for (const row of html.matchAll(RESULT_ROW)) {
    const [, href, rid, title, location] = row;
    if (seen.has(rid)) continue;
    seen.add(rid);
    jobs.push({
      externalId: rid,
      title: decode(title),
      location: decode(location) || undefined,
      url: decode(href),
      raw: { source: 'taleo-tbe', listingHtml: row[0] },
    });
  }
  return jobs;
}

/** Le texte complet d'une page `viewRequisition`, ou undefined si l'offre est retirée. */
export function parseTaleoDescription(html: string): string | undefined {
  if (/Job Not Available|no longer available/i.test(html) && !/cwsJobDescription/i.test(html)) return undefined;
  const start = html.search(/<div name="cwsJobDescription"/i);
  if (start < 0) return undefined;
  const rest = html.slice(start);
  const end = rest.search(DESCRIPTION_END);
  const block = end > 0 ? rest.slice(0, end) : rest;
  return htmlToPlainText(block) || undefined;
}

/** « 2026-08-20 00:00:00.0 » (JSON-LD TBE) → minuit UTC de ce jour. Pure. */
export function parseTaleoDate(raw?: string): Date | undefined {
  const m = raw?.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/);
  if (!m) return undefined;
  const date = new Date(`${m[1]}T${m[2] ?? '00:00:00'}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export type TaleoDetail = { description?: string; postedAt?: Date };

/** Texte et date d'une page `viewRequisition` ; vide si l'offre est retirée. */
export function parseTaleoDetail(html: string): TaleoDetail {
  const description = parseTaleoDescription(html);
  if (!description) return {};
  return { description, postedAt: parseTaleoDate(html.match(/"datePosted"\s*:\s*"([^"]+)"/i)?.[1]) };
}

/** Keep the employer named by this requisition, never the portal's owner.
 * A page can contain other structured postings: only its exact URL and native
 * requisition ID may contribute employer evidence. Malformed/missing JSON-LD
 * leaves identity unresolved while retaining the readable description. */
export function applyTaleoDetail(job: NormalizedJob, html: string): NormalizedJob {
  const detail = parseTaleoDetail(html);
  const nodes = extractJobPostings(html).filter(node => node.url === job.url &&
    (node.identifier?.value == null || String(node.identifier.value) === job.externalId));
  const native = nodes.length === 1 ? normalizeJobPosting(nodes[0], job.url) : null;
  return { ...job, description: detail.description ?? job.description, postedAt: detail.postedAt ?? job.postedAt,
    ...(native?.company ? { company: native.company, employerEvidence: native.employerEvidence } : {}),
    ...(native?.publicationHold ? { publicationHold: native.publicationHold } : {}) };
}

function sessionCookie(response: Response): string | undefined {
  const raw = response.headers.get('set-cookie') ?? '';
  return raw.match(/JSESSIONID=[^;]+/)?.[0];
}

/** Une page de résultats lue, avec la preuve de ce qu'elle a servi. */
type SectionPage = { url: string; html: string; jobs: NormalizedJob[] };

async function readSection(origin: string, org: string, cws: string): Promise<SectionPage[]> {
  const base = `${origin}/ats/careers/v2/searchResults?org=${encodeURIComponent(org)}&cws=${encodeURIComponent(cws)}`;
  const first = await fetchWithRetry(base);
  const cookie = sessionCookie(first);
  const html = await first.text();
  const read: SectionPage[] = [{ url: base, html, jobs: parseTaleoListing(html) }];
  const seen = new Set(read[0].jobs.map((job) => job.externalId));

  for (let page = 1; page < MAX_PAGES && cookie; page += 1) {
    const url = `${base}&next&rowFrom=${page * PAGE_SIZE}&act=null&sortColumn=null&sortOrder=null`;
    const body = await fetchText(url, { headers: { cookie } });
    const rows = parseTaleoListing(body);
    const fresh = rows.filter((job) => !seen.has(job.externalId));
    /**
     * La page est retenue comme PREUVE même quand elle ne rend rien de neuf : elle a bien été servie, et sa
     * répétition (le portail re-sert la première page passé la dernière) fait partie de ce qui a été observé.
     */
    read.push({ url, html: body, jobs: rows });
    if (fresh.length === 0) break;
    for (const job of fresh) seen.add(job.externalId);
  }
  return read;
}

export async function fetchTaleoJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  const org = String(config.org ?? '');
  const sections = (Array.isArray(config.cws) ? config.cws : [config.cws]).map((value) => String(value ?? '')).filter(Boolean);
  if (!origin || !org || sections.length === 0) throw new Error('Taleo TBE origin, org and cws are required');

  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  let rawCount = 0;
  for (const cws of sections) {
    for (const read of await readSection(origin, org, cws)) {
      rawCount += read.jobs.length;
      /**
       * `rid` EST l'identifiant canonique de TBE : la même valeur alimente cette preuve et
       * `NormalizedJob.externalId` (`parseTaleoListing`). Le motif de ligne EXIGE un `rid` numérique et un
       * titre — une ligne sans l'un des deux n'est pas reconnue comme ligne du tout, donc aucune ligne
       * anonyme ni aucun rejet ne peut exister ici : ce que la page sert est exactement ce qu'elle nomme.
       */
      const ids = read.jobs.map((job) => job.externalId);
      pageEvidence.push({ url: read.url, checkedAt: captureObservedAt().toISOString(),
        sha256: createHash('sha256').update(read.html).digest('hex'),
        offset: pageEvidence.length * PAGE_SIZE, pagination: null,
        ids, canonicalIds: ids, publisherCounter: '',
        componentCounters: [`cws=${cws}`, `rows=${read.jobs.length}`] });
      for (const job of read.jobs) {
        if (seen.has(job.externalId)) continue;
        seen.add(job.externalId);
        jobs.push(job);
      }
    }
  }

  /**
   * TBE n'annonce AUCUN total : ni compteur de résultats, ni nombre de pages. La terminaison est donc
   * empirique — la page qui ne rend plus rien de neuf — et le parcours n'est jamais PROUVÉ complet.
   * Le contrat canonique, lui, est indépendant : il dit que ce qui est écrit a été vu, pas que tout a été vu.
   */
  const enumeration: AdapterResult['enumeration'] = {
    method: 'SESSION_PAGINATED_HTML_SECTIONS', endpoint: `${origin}/ats/careers/v2/searchResults?org=${encodeURIComponent(org)}`,
    pages: pageEvidence.length, rawCount, termination: 'NO_FRESH_ROW',
    canonicalAbsenceProofUsable: true, pageEvidence,
  };

  if (config.withDescriptions === false) return { jobs, enumeration };

  const limit = pLimit(Number(config.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY));
  const enriched = await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        try {
          const detailHtml = await fetchText(job.url);
          const enriched = applyTaleoDetail(job, detailHtml);
          return enriched.description
            ? { ...enriched, raw: { ...(job.raw as object), detailHtml, detailUrl: job.url } }
            : job;
        } catch {
          // Un détail injoignable ne doit pas faire perdre l'offre de liste.
          return job;
        }
      }),
    ),
  );
  return { jobs: enriched, enumeration };
}
