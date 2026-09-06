import * as cheerio from 'cheerio';
import pLimit from 'p-limit';
import { DEFAULT_DETAIL_CONCURRENCY, fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Eqwa — portails carrière « propulsé par Eqwa » (Nocibé : recrutement-nocibe.fr).
 *
 * La page `front-jobs.html` rend TOUTES les offres dans un seul tableau HTML
 * (DataTables côté client, aucune pagination serveur) : titre, date, contrat,
 * région, code postal + ville. La page `front-jobs-detail.html?id_job=N` porte
 * la description dans `.job-detail-desc`. Aucun JSON-LD nulle part — le
 * crawler générique ne voyait donc rien. Mesuré le 2026-09-06 : 306 offres,
 * 306 avec lieu et description, 25 s.
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HEADERS = { 'user-agent': USER_AGENT };

export type EqwaListingJob = {
  externalId: string;
  title: string;
  url: string;
  postedAt?: Date;
  contract?: string;
  region?: string;
  city?: string;
  postalCode?: string;
};

/** Le tableau des offres -> une ligne par offre. Pure. */
export function parseEqwaListing(html: string, origin: string): EqwaListingJob[] {
  const $ = cheerio.load(html);
  const seen = new Map<string, EqwaListingJob>();

  $('table.with-datatable tbody tr').each((_, tr) => {
    const link = $(tr).find('a[href*="id_job="]').first();
    const href = link.attr('href') ?? '';
    const id = /id_job=(\d+)/.exec(href)?.[1];
    const title = (link.attr('title') ?? link.text()).trim();
    if (!id || !title || seen.has(id)) return;

    // Le HTML source imbrique le <td> contrat DANS le <td> lieu ; le parseur
    // referme la cellule, ce qui donne bien trois cellules : offre, lieu, contrat.
    const cells = $(tr).find('td');
    const locationCell = cells.eq(1);
    const small = locationCell.find('small').first().text().trim();
    const region = locationCell.clone().children().remove().end().text().trim();
    const [, postalCode, city] = /^(\d{5})\s+(.+)$/.exec(small) ?? [];
    const dateRaw = cells.eq(0).attr('data-sort');
    const postedAt = dateRaw ? new Date(dateRaw) : undefined;

    seen.set(id, {
      externalId: id,
      title,
      url: new URL(href, origin).toString(),
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
      contract: cells.eq(2).text().trim() || undefined,
      region: region || undefined,
      city: city?.trim() || undefined,
      postalCode,
    });
  });

  return [...seen.values()];
}

/** La page de détail -> description en texte brut (+ lieu affiché, pour contrôle). Pure. */
export function parseEqwaDetail(html: string): { description?: string; location?: string } {
  const $ = cheerio.load(html);
  const description = htmlToPlainText($('.job-detail-desc').html() ?? '');
  const location = $('.job-detail-reference dt')
    .filter((_, dt) => /localisation/i.test($(dt).text()))
    .next('dd')
    .text()
    .trim();
  return { description: description || undefined, location: location || undefined };
}

/** `config.origin` : le portail, ex. "https://recrutement-nocibe.fr". */
export async function fetchEqwaJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('Eqwa origin required');

  const html = await fetchText(`${origin}/front-jobs.html`, { headers: HEADERS });
  const listing = parseEqwaListing(html, origin);
  // F-06 : un tableau vide sur une source cataloguée, c'est le gabarit qui a
  // changé, pas un employeur sans poste.
  if (listing.length === 0) throw new Error(`eqwa ${origin}: aucune ligne d'offre dans front-jobs.html`);

  const toJob = (row: EqwaListingJob, description?: string): NormalizedJob => ({
    externalId: row.externalId,
    title: row.title,
    location: [row.city, row.postalCode, row.region].filter(Boolean).join(', ') || undefined,
    city: row.city,
    postalCode: row.postalCode,
    region: row.region,
    contract: row.contract,
    url: row.url,
    postedAt: row.postedAt,
    description,
    raw: row,
  });

  if (config.withDescriptions === false) return { jobs: listing.map((row) => toJob(row)) };

  const limit = pLimit(Number(config.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY));
  const jobs = await Promise.all(
    listing.map((row) =>
      limit(async () => {
        try {
          return toJob(row, parseEqwaDetail(await fetchText(row.url, { headers: HEADERS })).description);
        } catch {
          // Une fiche indisponible garde l'offre (titre, lieu, lien) sans description.
          return toJob(row);
        }
      }),
    ),
  );
  return { jobs };
}
