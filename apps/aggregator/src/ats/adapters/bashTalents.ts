import pLimit from 'p-limit';
import { DEFAULT_DETAIL_CONCURRENCY, fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';

/**
 * Ba&sh — portail maison `talents.ba-sh.com` (PHP « FRONTOFFICE », jQuery).
 * Mesuré le 2026-09-06 :
 *
 * 1. Le listing `/fr-FR/offres` est RENDU SERVEUR : 426 Ko de HTML avec les
 *    50 offres (« 50 Résultats ») en microdonnées `itemscope JobPosting` —
 *    aucun XHR ne liste les offres (Playwright n'en capture aucun), aucun
 *    JSON-LD, pas de sitemap (404). L'hôte `carriere.ba-sh.com` du brief
 *    n'existe pas (NXDOMAIN) ; le lien « Carrières » de ba-sh.com pointe
 *    sur `talents.ba-sh.com/fr-FR/offres`.
 *
 * 2. Le listing porte titre, métier, lieu (ville, région), contrat, date de
 *    publication (jj/mm/aaaa) — mais la description n'y est remplie que sur
 *    3 offres sur 50. Le texte complet vit sur la page de détail
 *    `/fr-FR/offre/BASH_xxx` : bloc « Descriptif du poste » (`itemprop=
 *    "description"`) suivi du bloc « Profil recherché ». Une requête par
 *    offre, 4 en parallèle.
 *
 * 3. Le HTML des descriptions est un document Word collé (`<!DOCTYPE html>`
 *    imbriqué, styles `Mso*`) : on le passe au nettoyeur commun.
 */

const DEFAULT_ORIGIN = 'https://talents.ba-sh.com';
const DEFAULT_LOCALE = 'fr-FR';

/** Un bloc d'offre, de son `job-wrapper` au suivant. */
const CARD_SPLIT = /<div class="job-wrapper[^"]*" attr-href="/;

const FIELD = {
  id: /^([^"]*\/offre\/(BASH_[A-Z0-9]+))"/,
  title: /itemprop="title"[^>]*>\s*([^<]{2,200}?)\s*</i,
  industry: /itemprop="industry"[^>]*>\s*([^<]{1,120}?)\s*</i,
  location: /icon-position"><\/i>\s*<b>([^<]{1,120}?)<\/b>/i,
  contract: /icon-contract"><\/i>\s*<b>([^<]{1,60}?)<\/b>/i,
  city: /itemprop="addressLocality"[^>]*>\s*([^<]{1,80}?)\s*</i,
  region: /itemprop="addressRegion"[^>]*>\s*([^<]{1,80}?)\s*</i,
  posted: /itemprop="datePosted"[^>]*>\s*(\d{2}\/\d{2}\/\d{4})\s*</i,
  employment: /itemprop="employmentType"[^>]*>\s*([^<]{1,40}?)\s*</i,
  description: /itemprop="description"[^>]*>([\s\S]*?)<\/div>/i,
  /** « 50 Résultats » en tête de liste : le total annoncé par le site. */
  total: /(\d+)\s*R[ée]sultats?/i,
};

const DETAIL = {
  description: /<div class="[^"]*cms-content"[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>\s*(?:<hr|<p class="title-default"|<\/section)/i,
  profile: /Profil recherch[ée]<\/p>\s*<div class="[^"]*cms-content"[^>]*>([\s\S]*?)<\/div>\s*(?:<hr|<p class="title-default"|<\/section|<div class="text-center)/i,
  experience: /itemprop="experienceRequirements"[^>]*>\s*([^<]{1,80}?)\s*</i,
};

/**
 * Les descriptions sont du Word collé, encodé en entités NOMMÉES (`&eacute;`,
 * `&ccedil;`, `&laquo;`…) que le nettoyeur commun ne connaît pas (il décode
 * les numériques et une poignée de typographiques). Sans cette passe, le
 * candidat lirait « l'&eacute;quipe » — mesuré sur les 50 offres.
 */
const NAMED_ENTITIES: Record<string, string> = {
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í',
  icirc: 'î', iuml: 'ï', ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ',
  ouml: 'ö', oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý',
  yuml: 'ÿ', oelig: 'œ', szlig: 'ß',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Auml: 'Ä', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É',
  Ecirc: 'Ê', Euml: 'Ë', Icirc: 'Î', Iuml: 'Ï', Ocirc: 'Ô', Ouml: 'Ö', Ugrave: 'Ù',
  Ucirc: 'Û', Uuml: 'Ü', OElig: 'Œ',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚',
  bdquo: '„', middot: '·', bull: '•', deg: '°', euro: '€', pound: '£', copy: '©',
  reg: '®', trade: '™', times: '×', frac12: '½', iexcl: '¡', iquest: '¿', shy: '',
};

function decodeNamedEntities(value: string): string {
  return value.replace(/&([A-Za-z]+[0-9]*);/g, (whole, name: string) =>
    name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : whole,
  );
}

/** Texte brut d'un fragment HTML : entités nommées, puis le nettoyeur commun. */
function plain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return htmlToPlainText(decodeNamedEntities(value)) || undefined;
}

function decode(value: string | undefined): string | undefined {
  const text = plain(value)?.replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function parseDayMonthYear(value: string | undefined): Date | undefined {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return undefined;
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
}

/** Les offres du listing. Exporté pour être testé sans réseau. */
export function parseBashListing(html: string): { jobs: NormalizedJob[]; declaredTotal?: number } {
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  const declaredTotal = html.match(FIELD.total)?.[1];

  for (const block of html.split(CARD_SPLIT).slice(1)) {
    const link = block.match(FIELD.id);
    const title = decode(block.match(FIELD.title)?.[1]);
    if (!link || !title) continue;
    const externalId = link[2];
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    const city = decode(block.match(FIELD.city)?.[1]);
    const region = decode(block.match(FIELD.region)?.[1]);
    const location = decode(block.match(FIELD.location)?.[1]) ?? [city, region].filter(Boolean).join(', ');
    jobs.push({
      externalId,
      title,
      location: location || undefined,
      city,
      region,
      contract: decode(block.match(FIELD.contract)?.[1]),
      workingTime: decode(block.match(FIELD.employment)?.[1]),
      department: decode(block.match(FIELD.industry)?.[1]),
      description: plain(block.match(FIELD.description)?.[1]),
      url: link[1],
      postedAt: parseDayMonthYear(block.match(FIELD.posted)?.[1]),
      raw: { source: 'bash-talents' },
    });
  }

  return { jobs, declaredTotal: declaredTotal ? Number(declaredTotal) : undefined };
}

/** Description complète (poste + profil) d'une page de détail. */
export function parseBashDetail(html: string): { description?: string; experience?: string } {
  const parts = [html.match(DETAIL.description)?.[1], html.match(DETAIL.profile)?.[1]]
    .map((part) => plain(part))
    .filter(Boolean);
  return {
    description: parts.join('\n\n') || undefined,
    experience: decode(html.match(DETAIL.experience)?.[1]),
  };
}

export async function fetchBashTalentsJobs(config: Record<string, unknown> = {}): Promise<AdapterResult> {
  const origin = String(config.origin ?? DEFAULT_ORIGIN).replace(/\/$/, '');
  const locale = String(config.locale ?? DEFAULT_LOCALE);
  const withDescriptions = config.withDescriptions !== false;

  const listing = await fetchText(`${origin}/${locale}/offres`);
  const { jobs: listed, declaredTotal } = parseBashListing(listing);

  const limit = pLimit(Number(config.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY));
  const jobs = withDescriptions
    ? await Promise.all(
        listed.map((job) =>
          limit(async (): Promise<NormalizedJob> => {
            try {
              const detail = parseBashDetail(await fetchText(job.url));
              // Le listing ne porte la description que sur 3 offres sur 50 :
              // le détail prime dès qu'il en a une.
              return {
                ...job,
                description: detail.description ?? job.description,
                raw: { ...(job.raw as object), experience: detail.experience },
              };
            } catch {
              // Sans détail, l'offre garde titre, lieu, contrat, date et URL.
              return job;
            }
          }),
        ),
      )
    : listed;

  return { jobs, declaredTotal, truncated: declaredTotal !== undefined && jobs.length < declaredTotal };
}
