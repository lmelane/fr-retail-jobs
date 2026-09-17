import pLimit from 'p-limit';
import { log } from '../../observability/logger.js';
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
  /**
   * « Date de publication » de la fiche — la SEULE vraie.
   *
   * Le listing sert `datePosted` = la date du JOUR sur les 50 offres à la fois
   * (un horodatage de rafraîchissement), quand les fiches portent des dates
   * échelonnées.
   *
   * Mesuré contre la source le 2026-09-17 (`npm run verif:bash-live`) :
   * 50/50 offres datées, 7 dates distinctes. Avant ce correctif : une seule.
   *
   * Ce que ça coûtait, et ce n'est PAS un défaut d'affichage : R-83 / D-415
   * classe le matching candidat « du plus récent au plus ancien, au jour
   * calendaire parisien près », les préférences de R-82 ne départageant qu'à
   * jour égal. Une source dont les 50 offres portent le même jour neutralise
   * donc le critère PRINCIPAL de son propre tier — le classement retombe sur
   * les critères secondaires. La date n'est plus montrée au candidat depuis
   * D-415 (elle ne survit qu'en JSON-LD, flux et sitemap) : l'erreur était
   * invisible à l'écran tout en pilotant l'ordre des offres.
   *
   * Portée, en revanche, bornée côté rapprochement : `dedup/match.ts`
   * n'applique aucune contrainte de date — vérifié le 2026-09-17, `postedAt`
   * n'y est pas lu — donc corriger cette date ne peut ni créer ni supprimer un
   * doublon.
   *
   * ANCRÉE sur le libellé « Date de publication », et non sur le seul attribut
   * `itemprop`. Les quatre fiches mesurées le 2026-09-17 n'en portent qu'une
   * occurrence, mais `String.match` sans drapeau global rend la PREMIÈRE du
   * document : le jour où le portail ajoute un bloc « offres similaires » en
   * microdonnées `JobPosting` — le listing en sert déjà — une date étrangère
   * passerait devant, silencieusement et sans faire rougir un témoin.
   */
  posted: /Date de publication[^<]*<\/b>\s*<span[^>]*itemprop="datePosted"[^>]*>\s*(\d{2}\/\d{2}\/\d{4})\s*</i,
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

/**
 * Une date « jj/mm/aaaa », ou `undefined` si le portail n'en sert pas une vraie.
 *
 * `Date.UTC` ne REFUSE pas un champ hors bornes, il le reporte : le 31/06 (juin
 * compte 30 jours) devient le 1er juillet, le 29/02/2026 (année non bissextile)
 * devient le 1er mars, le 00/00 recule à novembre de l'année précédente. Chacune
 * de ces valeurs a l'air d'une date normale une fois en base, et `plausiblePostedAt`
 * ne la rattrape pas : il n'écarte que `NaN` et le futur lointain.
 *
 * Le lot corrige une date fausse ; la laisser revenir par ce chemin le viderait de
 * son sens. D'où l'aller-retour : on ne garde la date que si elle se relit à
 * l'identique, seule manière de distinguer un report silencieux d'une vraie date.
 */
function parseDayMonthYear(value: string | undefined): Date | undefined {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return undefined;
  const [jour, mois, annee] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  const intacte =
    date.getUTCDate() === jour && date.getUTCMonth() === mois - 1 && date.getUTCFullYear() === annee;
  return intacte ? date : undefined;
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

/** Description complète (poste + profil), date de publication réelle et expérience d'une fiche. */
export function parseBashDetail(html: string): { description?: string; experience?: string; postedAt?: Date } {
  const parts = [html.match(DETAIL.description)?.[1], html.match(DETAIL.profile)?.[1]]
    .map((part) => plain(part))
    .filter(Boolean);
  return {
    description: parts.join('\n\n') || undefined,
    experience: decode(html.match(DETAIL.experience)?.[1]),
    postedAt: parseDayMonthYear(html.match(DETAIL.posted)?.[1]),
  };
}

export async function fetchBashTalentsJobs(config: Record<string, unknown> = {}): Promise<AdapterResult> {
  const origin = String(config.origin ?? DEFAULT_ORIGIN).replace(/\/$/, '');
  const locale = String(config.locale ?? DEFAULT_LOCALE);
  const withDescriptions = config.withDescriptions !== false;

  const listing = await fetchText(`${origin}/${locale}/offres`);
  const { jobs: listed, declaredTotal } = parseBashListing(listing);

  const limit = pLimit(Number(config.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY));
  let detailFailures = 0;
  const jobs = withDescriptions
    ? await Promise.all(
        listed.map((job) =>
          limit(async (): Promise<NormalizedJob> => {
            try {
              const detail = parseBashDetail(await fetchText(job.url));
              // Le listing ne porte la description que sur 3 offres sur 50, et
              // sa date est celle du jour sur les 50 : le détail prime sur les
              // deux dès qu'il les a.
              return {
                ...job,
                description: detail.description ?? job.description,
                postedAt: detail.postedAt ?? job.postedAt,
                raw: { ...(job.raw as object), experience: detail.experience },
              };
            } catch {
              // Sans détail, l'offre garde titre, lieu, contrat et URL, et reste
              // servie : un incident réseau ne doit pas retirer du catalogue un
              // poste réellement ouvert.
              //
              // Mais elle part SANS DATE, plutôt qu'avec celle du listing. Cette
              // dernière vaut « aujourd'hui » pour les 50 offres à la fois : la
              // garder ferait annoncer « publiée aujourd'hui » sur une offre de
              // trois semaines, et surtout l'écrirait PAR-DESSUS la vraie date
              // déjà en base — `upsert.ts` pose `postedAt: candidate.postedAt ??
              // null` sans condition, donc chaque échec de fiche rajeunirait
              // l'offre. Une absence, elle, n'écrase rien de faux : la fiche
              // n'affiche alors aucune date (`dateRelative` rend une chaîne vide)
              // et le classement relègue l'offre au lieu de la faire remonter.
              //
              // Le référencement ne paie pas ce choix : le sitemap exige AUSSI
              // 100 caractères de description (`sitemap-emplois.ts`), et 49 de ces
              // 50 offres n'en ont aucune au listing — elles en sont déjà exclues.
              detailFailures += 1;
              return { ...job, postedAt: undefined };
            }
          }),
        ),
      )
    : listed;

  // Un détail qui tombe en masse (ralentissement, limitation de débit sur 50
  // requêtes en rafale) est un incident de collecte, pas un run normal.
  if (detailFailures > 0) {
    await log.warn(
      'adapter.incomplete',
      `[bashTalents] ${detailFailures}/${listed.length} detail pages unreachable; those offers ship without description nor real posting date`,
    );
  }

  return { jobs, declaredTotal, truncated: declaredTotal !== undefined && jobs.length < declaredTotal };
}
