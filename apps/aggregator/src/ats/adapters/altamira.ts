import { createHash } from 'node:crypto';
import { log } from '../../observability/logger.js';
import pLimit from 'p-limit';
import { fetchText } from '../../lib/http.js';
import { enrichPostingEvidence } from '../../lib/postingEvidence.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Altamira Recruiting — ATS italien (portail « maison » d'Ermenegildo Zegna
 * Group : Zegna, Thom Browne, TOM FORD Fashion), mesuré le 2026-09-06.
 *
 * Le portail est un WebForms ASP.NET. La liste est
 * paginée par `PagerAnnunci=N` (1-based, 10 offres par page) et rend la
 * DERNIÈRE page en boucle au-delà de la fin (page 7 = page 6 sur Zegna) :
 * on s'arrête à la première page sans identifiant nouveau, pas sur une page
 * vide. Chaque ligne porte titre + « Ville , Pays » ; la page détail
 * (`/jobs/job-details?JobID=…&Team=…`) porte les champs dans des cellules
 * `data-title="…"` : Text (description), Brand (la maison), Locations
 * (« Pays/Région/Ville »), Contract type, JOB FUNCTION. Lorsqu'un JobPosting
 * JSON-LD est présent, son contenu et ses dates complètent ces champs.
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

/**
 * Les cellules `data-title` d'une fiche, en texte, avec l'adresse et l'empreinte de la page qui les porte.
 *
 * Toutes les fiches ne portent pas de JobPosting JSON-LD (30/09/2026) : 4 fiches Zegna sur 65 de la collecte du 29/09
 * (JobID 275749301, 272432342, 262106032, 249374382) n'en ont aucun, alors que leurs cellules donnent titre, lieu,
 * Maison et description. Le collecteur les lisait ; le lecteur de récupération exigeait le JSON-LD, les refusait
 * DETAIL_EVIDENCE_UNUSABLE, et 4 refus dépassant le plancher de 2, la source était rejetée chaque jour.
 */
export type AltamiraDetail = { pageUrl: string; htmlSha256: string; title: string; description: string;
  brand: string; locations: string; contract: string; department: string };

/** Les cellules lues, dans la forme que le RAW retient : exportée pour la récupération hors réseau. */
export const ALTAMIRA_DETAIL_CELLS = ['title', 'description', 'brand', 'locations', 'contract', 'department'] as const;

export function readAltamiraDetail(html: string, pageUrl: string): AltamiraDetail {
  const cell = (title: string) => htmlToPlainText(detailCell(html, title) ?? '') ?? '';
  return { pageUrl, htmlSha256: createHash('sha256').update(html).digest('hex'), title: cell('Title'), description: cell('Text'),
    brand: cell('Brand'), locations: cell('Locations'), contract: cell('Contract type'), department: cell('JOB FUNCTION') };
}

/**
 * L'offre d'une fiche lue sur ses cellules : le même assemblage pour le collecteur et pour le lecteur de récupération,
 * qui la relit sur les cellules retenues sans réseau. Un second assemblage dériverait du premier sans que rien le signale.
 */
export function altamiraJobFromDetail(row: AltamiraRow, detail: AltamiraDetail): NormalizedJob {
  // « United States/NY/New York » : pays / région / ville, la région parfois absente.
  const parts = detail.locations.split('/').map((p) => p.trim()).filter(Boolean);
  const country = parts[0];
  const city = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const region = parts.length > 2 ? parts[1] : undefined;
  return {
    externalId: row.externalId,
    title: detail.title || row.title,
    location: row.location ?? (parts.length ? [city, country].filter(Boolean).join(', ') : undefined),
    city,
    region,
    country,
    contract: detail.contract || undefined,
    department: detail.department || undefined,
    company: detail.brand || undefined,
    url: detail.pageUrl,
    description: detail.description || undefined,
    raw: { source: 'altamira', team: row.team, locations: detail.locations },
  };
}

/** Les champs de la fiche détail, fusionnés avec la ligne de liste. */
export function parseAltamiraDetail(row: AltamiraRow, html: string, url: string): NormalizedJob {
  const detail = readAltamiraDetail(html, url);
  const job = enrichPostingEvidence(altamiraJobFromDetail(row, detail), html);
  /*
   * Seule une page lue SANS aucun JobPosting retient ses cellules (`altamiraDetail`), liées à la même page que la preuve
   * (adresse et empreinte) : la récupération n'a rien d'autre à relire. Une page qui porte un JobPosting garde le RAW
   * d'avant, octet pour octet, et se relit toujours sur lui ; une page en échec (corps vide) ne retient rien.
   */
  const evidence = (job.raw as { postingEvidence?: { jobPostingCount?: number } }).postingEvidence;
  return html && evidence?.jobPostingCount === 0 ? { ...job, raw: { ...(job.raw as Record<string, unknown>), altamiraDetail: detail } } : job;
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
          await log.error('adapter.detail_failed', `[altamira] ${url}: ${(error as Error).message.slice(0, 120)}`, { error });
          return parseAltamiraDetail(row, '', url);
        }
      }),
    ),
  );

  return { jobs, truncated: rows.length >= maxPages * PAGE_SIZE_HINT };
}
