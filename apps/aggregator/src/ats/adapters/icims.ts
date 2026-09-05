import { fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * iCIMS — portails `{tenant}.icims.com`.
 *
 * Deux pièges, tous deux mesurés le 2026-09-05 sur hub-urbn.icims.com :
 *
 * 1. La page de recherche « normale » sert une coquille de 900 Ko sans une
 *    seule offre — c'est un cadre applicatif. Les offres vivent dans une IFRAME
 *    dont l'URL ne diffère que par `in_iframe=1`. Avec ce paramètre, la même
 *    requête rend 136 Ko de HTML SERVEUR contenant 48 offres complètes : ni
 *    navigateur, ni API privée.
 *
 * 2. La pagination passe par `pr=N`, 0-INDEXÉ — pas par un offset, et pas à
 *    partir de 1 : mesuré sur Aeropostale, `pr=0` rend ses 17 offres et
 *    `pr=1` en rend zéro. Démarrer à 1 sautait donc l'unique page d'un petit
 *    portail et le faisait passer pour vide.
 *
 * Chaque carte porte déjà lieu, identifiant, titre, lien ET un extrait de
 * description : une seule requête par page suffit, sans visiter les pages
 * détail — ce qui est à la fois plus rapide et plus poli pour l'hôte.
 */

/** Une carte d'offre : `<li class="… iCIMS_JobCardItem">` jusqu'à la suivante. */
const JOB_CARD = /<li[^>]*class="[^"]*iCIMS_JobCardItem[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;

const FIELD = {
  /** `<a href="…/jobs/{id}/{slug}/job?…" class="iCIMS_Anchor" …>` */
  link: /href="(https?:\/\/[^"]*\/jobs\/(\d+)\/[^"]*)"/i,
  title: /<h3[^>]*>\s*([^<]{2,160})<\/h3>/i,
  /** Le lieu suit son étiquette accessible, comme l'ID. */
  location: /field-label">Location<\/span>\s*<span[^>]*>\s*([^<]{2,80})</i,
  reference: /field-label">ID<\/span>\s*<span[^>]*>\s*([^<]{2,40})</i,
  description: /class="[^"]*description[^"]*"[^>]*>([\s\S]{0,1200}?)<\/div>/i,
};

function decode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Les offres d'une page de listing. Exporté pour être testé sans réseau. */
export function parseIcimsListing(html: string): NormalizedJob[] {
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();

  for (const card of html.matchAll(JOB_CARD)) {
    const block = card[1];
    const link = block.match(FIELD.link);
    const title = block.match(FIELD.title)?.[1];
    // Sans lien ni titre, l'offre n'est ni identifiable ni cliquable : la
    // rejeter vaut mieux que d'afficher une ligne vide au candidat.
    if (!link || !title) continue;

    const externalId = link[2];
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const description = block.match(FIELD.description)?.[1];
    jobs.push({
      externalId,
      title: decode(title),
      location: block.match(FIELD.location)?.[1]?.trim() || undefined,
      url: decode(link[1]),
      description: description ? htmlToPlainText(description) || undefined : undefined,
      raw: { source: 'icims', reference: block.match(FIELD.reference)?.[1]?.trim() },
    });
  }
  return jobs;
}

/** Nombre de pages lues au maximum — 50 × ~48 offres couvre les plus gros portails. */
const MAX_PAGES = 50;

export async function fetchIcimsJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  if (!origin) throw new Error('iCIMS origin missing');

  const out: NormalizedJob[] = [];
  const seen = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    /**
     * `in_iframe=1` fait basculer du cadre applicatif vers le HTML qui porte
     * réellement les offres — sans lui, la réponse est vide de sens.
     *
     * PAS de `searchRelation=keyword_all` : ce paramètre appartient à une
     * recherche par mots-clés, et sans mot-clé il filtre à vide sur certains
     * tenants — mesuré sur Aeropostale, 0 offre avec, 17 sans.
     */
    const url = `${origin}/jobs/search?ss=1&in_iframe=1&pr=${page}`;
    const html = await fetchText(url);
    const batch = parseIcimsListing(html);

    const fresh = batch.filter((job) => !seen.has(job.externalId));
    for (const job of fresh) {
      seen.add(job.externalId);
      out.push(job);
    }

    // Une page sans offre NOUVELLE termine la lecture : les portails iCIMS
    // rendent la dernière page en boucle plutôt qu'une page vide, donc compter
    // sur un lot vide bouclerait jusqu'à MAX_PAGES pour rien.
    if (fresh.length === 0) break;
  }

  return { jobs: out };
}
