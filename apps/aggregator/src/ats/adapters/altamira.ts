import pLimit from 'p-limit';
import { fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Altamira Recruiting — ATS italien (portail « maison » d'Ermenegildo Zegna
 * Group : Zegna, Thom Browne, TOM FORD Fashion), mesuré le 2026-09-06.
 *
 * Aucune API ni JSON-LD : le portail est un WebForms ASP.NET. La liste est
 * paginée par `PagerAnnunci=N` (1-based, 10 offres par page) et rend la
 * DERNIÈRE page en boucle au-delà de la fin (page 7 = page 6 sur Zegna) :
 * on s'arrête à la première page sans identifiant nouveau, pas sur une page
 * vide. Chaque ligne porte titre + « Ville , Pays » ; la page détail
 * (`/jobs/job-details?JobID=…&Team=…`) porte les champs dans des cellules
 * `data-title="…"` : Text (description), Brand (la maison), Locations
 * (« Pays/Région/Ville »), Contract type, JOB FUNCTION. Pas de date publiée.
 *
 * Le sitemap.xml du portail liste 66 URLs `/jobs/<slug>-<id>.htm` qui
 * répondent toutes 404 : il est périmé, ne pas s'y fier.
 */

const PAGE_SIZE_HINT = 10;
const DEFAULT_MAX_PAGES = 60;

/** `<a href="/jobs/job-details?JobID=…&Team=…" …> … </a>` — le `&` peut être encodé. */
const ROW = /<a\s+href="\/jobs\/job-details\?JobID=(\d+)(?:&amp;|&)Team=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
const ROW_FIELD = {
  title: /cellText--bold"[^>]*>\s*([^<][^<]*?)\s*<\/span>/i,
  location: /<span class="tableJobs__cellText">\s*([^<]+?)\s*<\/span>/i,
};

/** Une cellule `data-title="X"` de la fiche détail, jusqu'à sa fermeture. */
function detailCell(html: string, title: string): string | undefined {
  const re = new RegExp(`data-title="${title.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}"[^>]*>([\\s\\S]*?)<\\/td>`, 'i');
  return html.match(re)?.[1];
}

export type AltamiraRow = { externalId: string; team: string; title: string; location?: string };

/** Les lignes d'une page de liste. Exporté pour être testé sans réseau. */
export function parseAltamiraListing(html: string): AltamiraRow[] {
  const rows: AltamiraRow[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(ROW)) {
    const [, externalId, team, block] = match;
    const title = block.match(ROW_FIELD.title)?.[1];
    if (!title || seen.has(externalId)) continue;
    seen.add(externalId);
    const location = block.match(ROW_FIELD.location)?.[1]?.replace(/\s*,\s*/g, ', ').trim();
    rows.push({ externalId, team, title: htmlToPlainText(title) ?? title, location: location || undefined });
  }
  return rows;
}

/** Les champs de la fiche détail, fusionnés avec la ligne de liste. */
export function parseAltamiraDetail(row: AltamiraRow, html: string, url: string): NormalizedJob {
  const locations = htmlToPlainText(detailCell(html, 'Locations') ?? '') ?? '';
  // « United States/NY/New York » : pays / région / ville, la région parfois absente.
  const parts = locations.split('/').map((p) => p.trim()).filter(Boolean);
  const country = parts[0];
  const city = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const region = parts.length > 2 ? parts[1] : undefined;
  const description = htmlToPlainText(detailCell(html, 'Text') ?? '');
  const brand = htmlToPlainText(detailCell(html, 'Brand') ?? '');

  return {
    externalId: row.externalId,
    title: htmlToPlainText(detailCell(html, 'Title') ?? '') || row.title,
    location: row.location ?? (parts.length ? [city, country].filter(Boolean).join(', ') : undefined),
    city,
    region,
    country,
    contract: htmlToPlainText(detailCell(html, 'Contract type') ?? '') || undefined,
    department: htmlToPlainText(detailCell(html, 'JOB FUNCTION') ?? '') || undefined,
    company: brand || undefined,
    url,
    description: description || undefined,
    raw: { source: 'altamira', team: row.team, locations },
  };
}

export async function fetchAltamiraJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('Altamira origin missing');
  const maxPages = Number(config.maxPages ?? DEFAULT_MAX_PAGES);

  const rows: AltamiraRow[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages; page += 1) {
    const listUrl = `${origin}/default?ctl294=${page}&FreeSearch=&RunDefaultAction=true&StartupViewID=TableView&PagerAnnunci=${page}`;
    const fresh = parseAltamiraListing(await fetchText(listUrl)).filter((row) => !seen.has(row.externalId));
    for (const row of fresh) {
      seen.add(row.externalId);
      rows.push(row);
    }
    // Dernière page rendue en boucle : aucune ligne nouvelle = fin de liste.
    if (fresh.length === 0) break;
  }
  if (rows.length === 0) {
    throw new Error(`Altamira ${origin}: aucune ligne d'offre — gabarit ou portail cassé`);
  }

  const limit = pLimit(Number(config.concurrency ?? 4));
  const jobs = await Promise.all(
    rows.map((row) =>
      limit(async () => {
        const url = `${origin}/jobs/job-details?JobID=${row.externalId}&Team=${row.team}`;
        try {
          return parseAltamiraDetail(row, await fetchText(url), url);
        } catch (error) {
          console.error(`[altamira] ${url}: ${(error as Error).message.slice(0, 120)}`);
          return parseAltamiraDetail(row, '', url);
        }
      }),
    ),
  );

  return { jobs, truncated: rows.length >= maxPages * PAGE_SIZE_HINT };
}
