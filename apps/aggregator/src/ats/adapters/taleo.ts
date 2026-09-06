import pLimit from 'p-limit';
import { fetchText, fetchWithRetry, DEFAULT_DETAIL_CONCURRENCY } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

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
      raw: { source: 'taleo-tbe' },
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

function sessionCookie(response: Response): string | undefined {
  const raw = response.headers.get('set-cookie') ?? '';
  return raw.match(/JSESSIONID=[^;]+/)?.[0];
}

async function readSection(origin: string, org: string, cws: string): Promise<NormalizedJob[]> {
  const base = `${origin}/ats/careers/v2/searchResults?org=${encodeURIComponent(org)}&cws=${encodeURIComponent(cws)}`;
  const first = await fetchWithRetry(base);
  const cookie = sessionCookie(first);
  const jobs = parseTaleoListing(await first.text());
  const seen = new Set(jobs.map((job) => job.externalId));

  for (let page = 1; page < MAX_PAGES && cookie; page += 1) {
    const url = `${base}&next&rowFrom=${page * PAGE_SIZE}&act=null&sortColumn=null&sortOrder=null`;
    const html = await fetchText(url, { headers: { cookie } });
    const fresh = parseTaleoListing(html).filter((job) => !seen.has(job.externalId));
    if (fresh.length === 0) break;
    for (const job of fresh) {
      seen.add(job.externalId);
      jobs.push(job);
    }
  }
  return jobs;
}

export async function fetchTaleoJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  const org = String(config.org ?? '');
  const sections = (Array.isArray(config.cws) ? config.cws : [config.cws]).map((value) => String(value ?? '')).filter(Boolean);
  if (!origin || !org || sections.length === 0) throw new Error('Taleo TBE origin, org and cws are required');

  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  for (const cws of sections) {
    for (const job of await readSection(origin, org, cws)) {
      if (seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
    }
  }

  if (config.withDescriptions === false) return { jobs };

  const limit = pLimit(Number(config.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY));
  const enriched = await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        try {
          const detail = parseTaleoDetail(await fetchText(job.url));
          return detail.description
            ? { ...job, description: detail.description, postedAt: detail.postedAt ?? job.postedAt }
            : job;
        } catch {
          // Un détail injoignable ne doit pas faire perdre l'offre de liste.
          return job;
        }
      }),
    ),
  );
  return { jobs: enriched };
}
