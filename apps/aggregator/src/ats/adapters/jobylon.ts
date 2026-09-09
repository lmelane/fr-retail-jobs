import { log } from '../../observability/logger.js';
import pLimit from 'p-limit';
import { fetchText } from '../../lib/http.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { parseJobPostings } from './genericJsonLd.js';

/**
 * Jobylon — ATS suédois embarqué en « widget » sur les pages carrière
 * (Acne Studios, mesuré le 2026-09-06).
 *
 * La page carrière ne porte AUCUN lien d'offre : un `<div id="jobylon-jobs-widget">`
 * et un script `cdn.jobylon.com/embedder.js` avec `jbl_company_id`. Le widget
 * charge `cdn.jobylon.com/jobs/companies/{id}/embed/v2/` — une page HTML qui
 * embarque TOUTES les offres dans un littéral JavaScript (`JBL.embed_v2['jobs']`),
 * pas en JSON : clés sans guillemets, chaînes en apostrophes, `'` pour
 * l'apostrophe. `page_size` ne change rien au contenu (27 offres avec 10 comme
 * avec 100) : la pagination est côté client.
 *
 * Chaque offre a une page publique `emp.jobylon.com{url}` avec un JSON-LD
 * JobPosting complet (description, lieu, datePosted) : on la lit avec le parseur
 * partagé du générique, et le littéral sert de LISTE (id, titre, pays).
 */

const EMBED_BASE = 'https://cdn.jobylon.com/jobs/companies';
const PUBLIC_ORIGIN = 'https://emp.jobylon.com';

/** Décode les échappements JavaScript d'une chaîne du littéral (`'`, `\'`). */
function decodeJsString(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(['"\\/])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Une offre de la liste, telle que le littéral la décrit. */
export type JobylonListing = {
  externalId: string;
  /** Chemin public, ex. `/jobs/379770-acne-studios-supply-chain-planner-japan/`. */
  path: string;
  title: string;
  company?: string;
  /** Première « couche » (Countries chez Acne) : le pays. */
  country?: string;
};

const JOB_START = /\{\s*id:\s*'(\d+)'\s*,/g;
const FIELD = {
  url: /\burl:\s*'((?:[^'\\]|\\.)*)'/,
  title: /\btitle:\s*'((?:[^'\\]|\\.)*)'/,
  company: /\bcompany:\s*'((?:[^'\\]|\\.)*)'/,
  layer1: /'layers_1':\s*\[\s*'((?:[^'\\]|\\.)*)'/,
};

/** Les offres du littéral `JBL.embed_v2['jobs']`. Exporté pour être testé sans réseau. */
export function parseJobylonEmbed(html: string): JobylonListing[] {
  const start = html.indexOf("JBL.embed_v2['jobs']");
  if (start < 0) return [];
  const source = html.slice(start);
  const starts = [...source.matchAll(JOB_START)];
  const out: JobylonListing[] = [];
  const seen = new Set<string>();

  starts.forEach((match, index) => {
    const from = match.index ?? 0;
    const to = index + 1 < starts.length ? (starts[index + 1].index ?? source.length) : source.length;
    const block = source.slice(from, to);
    const externalId = match[1];
    const path = block.match(FIELD.url)?.[1];
    const title = block.match(FIELD.title)?.[1];
    // Sans chemin ni titre, l'offre n'est ni cliquable ni lisible.
    if (!path || !title || seen.has(externalId)) return;
    seen.add(externalId);
    out.push({
      externalId,
      path: decodeJsString(path),
      title: decodeJsString(title),
      company: block.match(FIELD.company)?.[1] ? decodeJsString(block.match(FIELD.company)![1]) : undefined,
      country: block.match(FIELD.layer1)?.[1] ? decodeJsString(block.match(FIELD.layer1)![1]) : undefined,
    });
  });
  return out;
}

/**
 * Jobylon met le lieu lisible dans `streetAddress` (« Tokyo, Japan ») et laisse
 * `addressLocality` vide — le normaliseur partagé n'en tire donc aucun lieu.
 * On relit ce champ dans le nœud brut plutôt que d'afficher le seul pays.
 */
function streetAddressOf(raw: unknown): string | undefined {
  const node = raw as { jobLocation?: unknown } | undefined;
  const places = Array.isArray(node?.jobLocation) ? node!.jobLocation : [node?.jobLocation];
  for (const place of places) {
    const street = (place as { address?: { streetAddress?: unknown } } | undefined)?.address?.streetAddress;
    if (typeof street === 'string' && street.trim()) return street.trim();
  }
  return undefined;
}

/** Fusionne la ligne de liste et le JSON-LD de la page publique. */
export function mergeJobylonJob(listing: JobylonListing, detailHtml: string, url: string): NormalizedJob {
  const [posting] = parseJobPostings(detailHtml, url);
  return {
    ...(posting ?? {}),
    // L'identifiant Jobylon est stable et lisible ; le sha1 d'URL du générique ne l'est pas.
    externalId: listing.externalId,
    title: posting?.title || listing.title,
    url,
    company: posting?.company || listing.company,
    country: posting?.country || listing.country,
    location: posting?.location || streetAddressOf(posting?.raw) || listing.country,
    raw: { source: 'jobylon', listing, posting: posting?.raw },
  };
}

export async function fetchJobylonJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const companyId = String(config.companyId ?? '');
  if (!companyId) throw new Error('Jobylon companyId missing');

  const embedUrl = `${EMBED_BASE}/${encodeURIComponent(companyId)}/embed/v2/?target=jobylon-jobs-widget&page_size=100`;
  const listing = parseJobylonEmbed(await fetchText(embedUrl));
  if (listing.length === 0) {
    // Un widget sans littéral est un identifiant faux ou un format qui a bougé,
    // pas un employeur sans poste (F-06) : le dire plutôt que rendre [] en silence.
    throw new Error(`Jobylon ${companyId}: aucune offre dans le littéral embed — id ou format cassé`);
  }

  const limit = pLimit(Number(config.concurrency ?? 4));
  const jobs = await Promise.all(
    listing.map((row) =>
      limit(async () => {
        const url = new URL(row.path, PUBLIC_ORIGIN).toString();
        try {
          return mergeJobylonJob(row, await fetchText(url), url);
        } catch (error) {
          // Une page détail en erreur ne coule pas la source : la ligne de liste
          // suffit à annoncer le poste, la description viendra au run suivant.
          await log.error('adapter.detail_failed', `[jobylon] ${url}: ${(error as Error).message.slice(0, 120)}`, { error });
          return mergeJobylonJob(row, '', url);
        }
      }),
    ),
  );

  return { jobs, declaredTotal: listing.length };
}
