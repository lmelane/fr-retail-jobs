import { createHash } from 'node:crypto';
import { captureObservedAt } from '../../capture/context.js';
import { log } from '../../observability/logger.js';
import pLimit from 'p-limit';
import { fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { parseJobPostings } from './genericJsonLd.js';

/**
 * Swatch Group — `www.swatchgroup.com/{lang}/job-finder` (Drupal, derrière
 * Akamai : curl expire, `fetchText` passe en ~500 ms).
 *
 * Pourquoi un adaptateur dédié alors que les fiches portent un JSON-LD
 * JobPosting (mesuré le 2026-09-06 sur les 279 offres, rapport g1) :
 *
 * 1. Le JSON-LD met dans `jobLocation.address.streetAddress` l'adresse du
 *    SIÈGE de la filiale (« The Swatch Group (U.S.) Inc. 800 Waterford Way
 *    Miami ») — un lieu FAUX pour un poste à Charlotte — et dans
 *    `addressRegion` « CP + ville » du lieu de travail, vide sur 7 offres ;
 *    `addressLocality` et `addressCountry` sont vides sur 279/279. Le vrai lieu
 *    est dans le bloc HTML `#jl` (« Job location / Arbeitsort / Lieu de
 *    travail ») : rue · « CP ville (région) » · pays. On lit ce bloc, jamais
 *    `streetAddress`.
 * 2. Le JSON-LD `description` ne contient que la section `f-n-body` ; les
 *    sections entreprise, missions, profil requis et langues/avantages sont
 *    hors JSON-LD (48 offres sur 279 y ont moins de 500 caractères alors que
 *    la page en porte 2 000 à 4 000). On concatène les cinq champs Drupal dans
 *    l'ordre de la page.
 * 3. `hiringOrganization.name` est l'entité LÉGALE (« The Swatch Group
 *    (Deutschland) GmbH », « ETA SA ») ; la marque candidat est dans le logo
 *    `brands-logos/<marque>.png`, sinon en tête du titre.
 */

const DEFAULT_ORIGIN = 'https://www.swatchgroup.com';
const DEFAULT_LANG = 'fr';
const MAX_PAGES = 60;

/**
 * Logo → marque affichée. Fichiers `/sites/default/files/brands-logos/<fichier>.png`
 * OBSERVÉS sur les 279 fiches du 2026-09-06 (avec leur effectif) :
 *   swatch 57 · eta 44 · omega 38 · longines 16 · tissot 9 · blancpain 8 ·
 *   hour-passion 8 · swiss-timing 6 · nivarox 6 · rado 5 · renata 5 ·
 *   em-microelectronic 5 · universo 4 · breguet 4 · meco 4 · comadur 3 ·
 *   glashuette 3 · rw 3 · certina 1 · lascor 1 · micro-crystal 1 ·
 *   mom-le-prelet 1 · hamilton 1 · cpk 1 · swatch-group 45.
 * `swatch-group.png` est le logo GÉNÉRIQUE du groupe (postes des filiales pays
 * et fonctions groupe) : il n'est pas une marque, on retombe sur le titre.
 * Les noms non observés mais possibles (marques du groupe) sont listés pour ne
 * pas retomber sur « Swatch Group » le jour où ils apparaissent.
 */
const LOGO_TO_BRAND: Record<string, string> = {
  // Marques horlogères (candidat)
  swatch: 'Swatch',
  omega: 'Omega',
  longines: 'Longines',
  tissot: 'Tissot',
  rado: 'Rado',
  blancpain: 'Blancpain',
  breguet: 'Breguet',
  certina: 'Certina',
  mido: 'Mido',
  hamilton: 'Hamilton',
  'harry-winston': 'Harry Winston',
  harrywinston: 'Harry Winston',
  glashuette: 'Glashütte Original',
  glashutte: 'Glashütte Original',
  'glashutte-original': 'Glashütte Original',
  'glashuette-original': 'Glashütte Original',
  'union-glashutte': 'Union Glashütte',
  'union-glashuette': 'Union Glashütte',
  'jaquet-droz': 'Jaquet Droz',
  jaquetdroz: 'Jaquet Droz',
  balmain: 'Balmain',
  'flik-flak': 'Flik Flak',
  flikflak: 'Flik Flak',
  'hour-passion': 'Hour Passion',
  hourpassion: 'Hour Passion',
  tourbillon: 'Tourbillon',
  // Sociétés de production et services du groupe (postes réels, pas une marque candidat)
  eta: 'ETA',
  nivarox: 'Nivarox',
  comadur: 'Comadur',
  universo: 'Universo',
  meco: 'Meco',
  renata: 'Renata',
  'em-microelectronic': 'EM Microelectronic',
  'micro-crystal': 'Micro Crystal',
  'swiss-timing': 'Swiss Timing',
  lascor: 'Lascor',
  rw: 'Rubattel et Weyermann',
  'mom-le-prelet': 'MOM Le Prélet',
  cpk: 'CPK Swatch Group',
};

/** Marques repérables en tête (ou dans) un titre, par ordre de spécificité. */
const BRAND_IN_TITLE: Array<[RegExp, string]> = [
  [/\bharry\s*winston\b/i, 'Harry Winston'],
  [/\bglash[üu]e?tte\s*original\b/i, 'Glashütte Original'],
  [/\bunion\s*glash[üu]e?tte\b/i, 'Union Glashütte'],
  [/\bjaquet\s*droz\b/i, 'Jaquet Droz'],
  [/\bhour\s*passion\b/i, 'Hour Passion'],
  [/\bflik\s*flak\b/i, 'Flik Flak'],
  [/\bomega\b/i, 'Omega'],
  [/\blongines\b/i, 'Longines'],
  [/\btissot\b/i, 'Tissot'],
  [/\brado\b/i, 'Rado'],
  [/\bblancpain\b/i, 'Blancpain'],
  [/\bbreguet\b/i, 'Breguet'],
  [/\bcertina\b/i, 'Certina'],
  [/\bmido\b/i, 'Mido'],
  [/\bhamilton\b/i, 'Hamilton'],
  [/\bbalmain\b/i, 'Balmain'],
  [/\bswatch\b(?!\s*group)/i, 'Swatch'],
];

/** Libellé de pays du bloc `#jl` (langue de la fiche) → ISO-2 ; inconnu = libellé tel quel. */
const COUNTRY_LABELS: Record<string, string> = {
  'united states': 'US', 'états-unis': 'US', 'etats-unis': 'US', usa: 'US', 'vereinigte staaten': 'US', 'stati uniti': 'US',
  canada: 'CA', kanada: 'CA',
  switzerland: 'CH', suisse: 'CH', schweiz: 'CH', svizzera: 'CH',
  germany: 'DE', allemagne: 'DE', deutschland: 'DE', germania: 'DE',
  france: 'FR', frankreich: 'FR', francia: 'FR',
  italy: 'IT', italie: 'IT', italien: 'IT', italia: 'IT',
  spain: 'ES', espagne: 'ES', spanien: 'ES', spagna: 'ES', 'españa': 'ES',
  'united kingdom': 'GB', 'royaume-uni': 'GB', 'vereinigtes königreich': 'GB', 'regno unito': 'GB', 'great britain': 'GB',
  netherlands: 'NL', 'pays-bas': 'NL', niederlande: 'NL', 'paesi bassi': 'NL',
  austria: 'AT', autriche: 'AT', 'österreich': 'AT',
  denmark: 'DK', danemark: 'DK', 'dänemark': 'DK', danimarca: 'DK',
  sweden: 'SE', 'suède': 'SE', schweden: 'SE', svezia: 'SE',
  norway: 'NO', 'norvège': 'NO', norwegen: 'NO',
  australia: 'AU', australie: 'AU', australien: 'AU',
  thailand: 'TH', 'thaïlande': 'TH',
  malaysia: 'MY', malaisie: 'MY',
  'hong kong': 'HK',
  singapore: 'SG', singapour: 'SG', singapur: 'SG',
  japan: 'JP', japon: 'JP',
  china: 'CN', chine: 'CN',
  'united arab emirates': 'AE', 'émirats arabes unis': 'AE',
  belgium: 'BE', belgique: 'BE', belgien: 'BE',
  luxembourg: 'LU', luxemburg: 'LU',
  portugal: 'PT',
  poland: 'PL', pologne: 'PL', polen: 'PL',
  'czech republic': 'CZ', czechia: 'CZ',
  mexico: 'MX', mexique: 'MX',
  brazil: 'BR', 'brésil': 'BR',
  india: 'IN', inde: 'IN',
  'south korea': 'KR', korea: 'KR', 'corée du sud': 'KR',
  taiwan: 'TW',
  turkey: 'TR', turquie: 'TR',
};

const FIELD_ORDER = ['f-n-field-job-company-intro', 'f-n-body', 'f-n-field-job-profile', 'f-n-field-job-prof-requ', 'f-n-field-job-languages'];

/** Un champ Drupal : `<div class="field f-n-X …">…</div>` — sans div imbriquée sur ces pages. */
function drupalField(html: string, name: string): string | undefined {
  const re = new RegExp(`<div class="field ${name}[^"]*"[^>]*>([\\s\\S]*?)</div>`, 'i');
  return html.match(re)?.[1];
}

export type SwatchLocation = {
  location?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

/**
 * Le bloc `#jl` : étiquette, puis « rue<br/> CP ville (région)<br/> pays ».
 * Exporté pour être testé.
 */
export function parseJobLocationBlock(html: string): SwatchLocation {
  const block = html.match(/<div id="jl"[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (!block) return {};
  const lines = block
    .replace(/<p[^>]*>[\s\S]*?<\/p>/i, '')
    .split(/<br\s*\/?>/i)
    .map((line) => htmlToPlainText(line) ?? '')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return {};
  /**
   * Deux gabarits coexistent (mesuré sur 279 fiches) : 273 en trois lignes
   * « rue · CP ville (région) · pays », et 6 en une seule ligne
   * `<div class="field f-n-field-job-work-address">2000 Sydney</div>` — sans
   * pays. Sur celles-ci on garde le lieu tel quel ; le pays reste absent
   * plutôt que déduit de l'adresse de la filiale (qui n'est pas le lieu).
   */
  const [cityLine, countryLine] = lines.length >= 3 ? [lines[1], lines[2]] : lines.length === 2 ? [lines[0], lines[1]] : [lines[0], undefined];
  const region = cityLine.match(/\(([^)]+)\)\s*$/)?.[1]?.trim();
  const rest = cityLine.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const postalCode = rest.match(/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b|\b\d{4,6}\b/)?.[0];
  const city = rest
    .replace(postalCode ?? '', '')
    .replace(/^\s*[A-Z]{2}\s+/, '')
    .replace(/\s+[A-Z]{2}\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const country = countryLine ? (COUNTRY_LABELS[countryLine.toLowerCase()] ?? countryLine) : undefined;
  return {
    location: [rest, countryLine].filter(Boolean).join(', '),
    city: city || undefined,
    region,
    postalCode,
    country,
  };
}

/** La marque : logo, sinon titre, sinon le groupe. Exporté pour être testé. */
export function resolveBrand(logoUrl: string | undefined, title: string): string {
  const file = logoUrl?.match(/brands-logos\/([^/?#]+)\.(?:png|svg|jpe?g|webp)/i)?.[1]?.toLowerCase();
  if (file && LOGO_TO_BRAND[file]) return LOGO_TO_BRAND[file];
  for (const [re, brand] of BRAND_IN_TITLE) if (re.test(title)) return brand;
  return 'Swatch Group';
}

/** Une fiche complète. Exporté pour être testé sans réseau. */
export function parseSwatchJobPage(html: string, url: string): NormalizedJob | null {
  const [posting] = parseJobPostings(html, url);
  const externalId = url.match(/\/job\/(\d+)/)?.[1] ?? posting?.externalId;
  const h1 = htmlToPlainText(html.match(/<span class="field f-n-title[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
  // Le JSON-LD double-échappe les entités du titre (« &amp;amp; ») ; le <h1> non.
  const title = h1 || posting?.title;
  if (!externalId || !title) return null;

  const sections = FIELD_ORDER.map((name) => htmlToPlainText(drupalField(html, name) ?? '')).filter(Boolean);
  const description = sections.length ? sections.join('\n\n') : posting?.description;

  const loc = parseJobLocationBlock(html);
  const raw = posting?.raw as { hiringOrganization?: { name?: string; logo?: string } } | undefined;
  const logo = raw?.hiringOrganization?.logo ?? html.match(/<aside class="job-card">\s*<img src="([^"]+)"/i)?.[1];
  // Le bouton « Postuler » mène au formulaire Lumesse TalentLink (l'ATS réel derrière le site).
  const applyUrl = html.match(/href="(https:\/\/apply\d*\.lumessetalentlink\.com\/[^"]+)"/i)?.[1]?.replace(/&amp;/g, '&');
  const lang = url.match(/swatchgroup\.com\/([a-z]{2})\//)?.[1];

  return {
    externalId,
    title,
    // Le lieu de travail, jamais `streetAddress` (siège de la filiale). Repli :
    // `addressRegion` (« CP ville »), qui vient bien du lieu de travail.
    location: loc.location ?? posting?.region ?? undefined,
    city: loc.city,
    region: loc.region,
    postalCode: loc.postalCode,
    country: loc.country,
    contract: posting?.contract,
    language: lang,
    company: resolveBrand(logo, title),
    group: 'Swatch Group',
    url,
    postedAt: posting?.postedAt,
    validThrough: posting?.validThrough,
    description: description || undefined,
    /*
     * LES CHAMPS LUS ENTRENT DANS LE RAW (19/09/2026).
     *
     * `raw` ne portait que l'entité juridique, le logo, le lien de candidature et le JSON-LD —
     * ni intitulé, ni lieu, qui viennent du HTML de la page. Le rejeu
     * (`publication/recovery.ts`) n'avait donc rien à relire : 307 offres capturées et
     * conservées, refusées à la publication.
     *
     * La page complète vit déjà dans `RawBlob` ; on conserve ici ce que le lecteur en a tiré.
     */
    raw: {
      source: 'swatchgroup',
      title, url, language: lang,
      location: loc.location ?? posting?.region ?? undefined,
      city: loc.city, region: loc.region, postalCode: loc.postalCode, country: loc.country,
      contract: posting?.contract,
      company: resolveBrand(logo, title),
      description: description || undefined,
      postedAt: posting?.postedAt?.toISOString(),
      validThrough: posting?.validThrough?.toISOString(),
      legalEntity: raw?.hiringOrganization?.name, logo, applyUrl, jsonLd: posting?.raw,
    },
  };
}

/**
 * Le lien « Dernier » du pager Drupal, repéré par son icône (indépendante de la langue) :
 * `<a class="page-link" href="?page=34" aria-label="Dernier"><span aria-hidden="true"><i class="icon--last">`.
 */
const LAST_PAGE_LINK = /href="\?page=(\d+)"[^>]*>\s*<span[^>]*>\s*<i class="icon--last"/;
/**
 * Les langues du listing, dans l'ordre des relectures ; la langue configurée n'est pas relue (sauf si elle est la seule
 * nommée). Le décalage n'est pas aléatoire : relue dans la même langue, la liste cache les mêmes offres (six lectures du
 * 30/09 à 06:38, 340 distinctes sur 348, les mêmes huit offres servies deux fois, toujours en fin de page puis en tête
 * de la suivante). L'ordre du listing dépend de la langue : le 30/09 à 07:10, en français 328 distinctes, en anglais
 * 336, l'union 348, le total.
 */
const RECONCILIATION_LANGS = ['en', 'de', 'it', 'fr'];
/** Une page lue pour que l'ensemble des requêtes de listing reste le même d'une capture à l'autre, jamais comptée. */
const STABILITY = Symbol('stability');

export async function fetchSwatchGroupJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? DEFAULT_ORIGIN).replace(/\/$/, '');
  const lang = String(config.lang ?? DEFAULT_LANG);
  const maxPages = Number(config.maxPages ?? MAX_PAGES);

  const links: string[] = [];
  const seen = new Set<string>();
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  let pagesRead = 0;
  // Chaque carte porte le lien 3 fois (image, titre, « En savoir plus ») : dédoublonner dans la page, puis contre les
  // pages déjà lues, par l'identifiant de l'offre et non par l'adresse : le préfixe de langue varie d'une offre à
  // l'autre (en, fr, de, it sur la même page) et ne doit pas faire compter deux fois une offre qui en changerait
  // entre deux lectures. Rend le nombre d'offres distinctes de la page.
  // `admit` juge la page AVANT qu'elle ne compte : une page refusée (autre total annoncé) n'ajoute rien à l'union.
  // Une page de STABILITÉ (`admit === STABILITY`) est lue et archivée sans jamais compter : voir plus bas.
  const readPage = async (page: number, pass: number, pageLang = lang, admit?: ((html: string, count: number) => boolean) | typeof STABILITY): Promise<{ count: number; html: string; admitted: boolean }> => {
    const url = `${origin}/${pageLang}/job-finder?page=${page}`;
    const html = await fetchText(url);
    const inPage = new Map<string, string>();
    for (const m of html.matchAll(/href="(\/[a-z]{2}\/job\/(\d+))"/g)) if (!inPage.has(m[2])) inPage.set(m[2], `${origin}${m[1]}`);
    const stability = admit === STABILITY;
    const admitted = stability ? false : admit ? admit(html, inPage.size) : true;
    const fresh = admitted ? [...inPage].filter(([id]) => !seen.has(id)) : [];
    for (const [id, link] of fresh) {
      seen.add(id);
      links.push(link);
    }
    pagesRead += 1;
    pageEvidence.push({ url, checkedAt: captureObservedAt().toISOString(), sha256: createHash('sha256').update(html).digest('hex'), offset: page, pagination: null,
      ids: [...inPage.keys()], publisherCounter: '', componentCounters: [`pass=${pass}`, `lang=${pageLang}`,
        ...(stability ? ['role=STABILITY_NOT_COUNTED'] : admitted ? [] : ['refused=TOTAL_CHANGED']), `links=${inPage.size}`, `fresh=${fresh.length}`, `uniqueLinks=${seen.size}`] });
    return { count: inPage.size, html, admitted };
  };

  /*
   * LE TOTAL DE L'ÉDITEUR, ET NON LA PREMIÈRE PAGE SANS LIEN NOUVEAU (30/09/2026).
   *
   * Le listing n'a pas d'ordre stable : d'une page à l'autre une offre glisse, servie deux fois, et en cache une
   * autre. Le 30/09 à 05:13 : 35 pages (34 de 10, la dernière de 8) = 348 offres annoncées, 328 liens distincts lus,
   * 20 répétés, toujours sur deux pages voisines. L'ancienne règle s'arrêtait sur une page sans lien nouveau : elle
   * ne prouvait rien depuis le 24/09 (page vide au-delà de la fin), et le 23/09 elle avait « prouvé » 71 offres.
   *
   * La preuve est désormais le total que l'éditeur publie par son pager : le lien « Dernier » de la première page
   * donne l'index de la dernière page ; toutes les pages avant elle portent le même nombre de liens (celui de la
   * première) ; la dernière en porte de 1 à ce nombre ; la page suivante n'en porte aucun. Total = index × taille +
   * liens de la dernière. Le listing est relu dans chaque autre langue, dans l'ordre, tant que l'union des lectures
   * n'atteint pas ce total ; il n'est prouvé que si elle l'atteint exactement. Une langue qui annonce une autre dernière
   * page (total changé en cours de lecture) arrête le comptage : non prouvé.
   *
   * L'ENSEMBLE DES REQUÊTES DE LISTING NE DÉPEND PAS DE CE QU'ELLES RENDENT (RUN du 30/09/2026, 16:58).
   *
   * Au RUN, la source est lue deux fois : la capture de validation, dont le périmètre d'accès est dérivé des requêtes
   * EXACTES qu'elle a faites (`accessScopeDerivation.ts`), puis la capture d'ingestion, contrôlée contre ce périmètre.
   * L'ancien lecteur s'arrêtait dès que l'union atteignait le total : la validation de 16:56 avait trouvé les offres
   * manquantes dès la page 0 en anglais (périmètre `/en/job-finder` avec `page=0` FIXE, aucune autre langue),
   * l'ingestion de 16:58 a dû lire la page 1 en anglais : hors périmètre, source arrêtée (ACCESS_SCOPE).
   *
   * Désormais, dès que le pager donne une dernière page dans le budget, CHAQUE langue de réconciliation est lue en
   * entier, pages 0 à la dernière, quel que soit le résultat. Seules les lectures faites tant que la preuve se
   * construit comptent, exactement comme avant (même union, même verdict) ; les suivantes sont archivées sans compter
   * (`role=STABILITY_NOT_COUNTED`) : ajoutées à l'union, elles la feraient dépasser le total à la moindre différence de
   * cache entre langues (le 30/09 à 18:30, quatre langues lues à la même minute annonçaient 350, 350, 360 et 348). Le
   * prix : trois langues de 35 pages à chaque capture, soit 105 requêtes de listing après la lecture française, là où
   * l'arrêt anticipé en faisait de 1 à 175. Une capture sans lien « Dernier », ou au-delà du budget de pages, ne relit
   * aucune autre langue, comme avant : ces deux gabarits ne sont jamais prouvés.
   */
  const first = await readPage(0, 1);
  const lastIndex = Number(LAST_PAGE_LINK.exec(first.html)?.[1] ?? NaN);
  const pageSize = first.count;
  const shapeIssues: string[] = [];
  let termination: string;
  let publisherTotal: number | undefined;
  let lastCount = 0;
  if (!Number.isInteger(lastIndex) || lastIndex < 1) {
    // Sans lien « Dernier », aucun total : on lit comme avant, jusqu'à une page sans lien nouveau, sans rien prouver.
    shapeIssues.push('LAST_PAGE_LINK_ABSENT');
    termination = 'PAGE_BUDGET_EXHAUSTED';
    for (let page = 1; page < maxPages; page += 1) {
      const before = seen.size;
      const { count } = await readPage(page, 1);
      if (seen.size === before) { termination = count ? 'REPEATED_PAGE' : 'EMPTY_PAGE'; break; }
    }
  } else if (lastIndex + 1 >= maxPages) {
    shapeIssues.push('PAGE_BUDGET_EXHAUSTED');
    termination = 'PAGE_BUDGET_EXHAUSTED';
    for (let page = 1; page < maxPages; page += 1) await readPage(page, 1);
  } else {
    let shapeHolds = true;
    for (let page = 1; page <= lastIndex; page += 1) {
      const { count } = await readPage(page, 1);
      if (page < lastIndex ? count !== pageSize : count < 1 || count > pageSize) shapeHolds = false;
      if (page === lastIndex) lastCount = count;
    }
    const beyond = await readPage(lastIndex + 1, 1);
    termination = beyond.count === 0 ? 'EMPTY_PAGE' : 'PAGE_BEYOND_LAST_NOT_EMPTY';
    if (!shapeHolds) shapeIssues.push('PAGE_SIZE_INCONSISTENT');
    if (beyond.count !== 0) shapeIssues.push('PAGE_BEYOND_LAST_NOT_EMPTY');
    if (shapeHolds && beyond.count === 0) publisherTotal = lastIndex * pageSize + lastCount;
  }
  // Les relectures qui ont COMPTÉ (0 : la première lecture a suffi) ; les lectures de stabilité n'en sont pas.
  let countingSweeps = 0;
  if (Number.isInteger(lastIndex) && lastIndex >= 1 && lastIndex + 1 < maxPages) {
    const configured = Array.isArray(config.reconcileLangs) ? config.reconcileLangs.map(String) : RECONCILIATION_LANGS;
    const others = configured.filter((l) => l !== lang);
    const sweepLangs = others.length ? others : configured.slice(0, 1);
    // La preuve se construit tant qu'un total existe, qu'aucune langue ne l'a contredit et que l'union ne l'atteint pas.
    let counting = publisherTotal !== undefined;
    const stillCounting = () => counting && seen.size < publisherTotal!;
    for (const [index, sweepLang] of sweepLangs.entries()) {
      const pass = index + 2;
      if (stillCounting()) countingSweeps += 1;
      for (let page = 0; page <= lastIndex; page += 1) {
        if (!stillCounting()) { await readPage(page, pass, sweepLang, STABILITY); continue; }
        // La page 0 d'une autre langue doit annoncer la même dernière page ; chaque page doit porter le nombre de liens
        // attendu (celui de la première, ou de la dernière page lue) AVANT de compter : une page d'une autre forme est
        // un listing changé, pas une relecture (audit adverse).
        const expected = page < lastIndex ? pageSize : lastCount;
        const read = await readPage(page, pass, sweepLang, page === 0
          ? (html, count) => Number(LAST_PAGE_LINK.exec(html)?.[1] ?? NaN) === lastIndex && count === pageSize
          : (_html, count) => count === expected);
        if (!read.admitted) {
          shapeIssues.push('PUBLISHER_TOTAL_CHANGED');
          counting = false;
        }
      }
    }
    if (publisherTotal !== undefined) {
      if (seen.size === publisherTotal) termination = countingSweeps === 0 ? 'PUBLISHER_TOTAL_REACHED' : 'SECOND_SWEEP_RECONCILED';
      else shapeIssues.push(seen.size > publisherTotal ? 'UNION_ABOVE_PUBLISHER_TOTAL' : 'PUBLISHER_TOTAL_NOT_REACHED');
    }
  }
  if (links.length === 0) throw new Error(`Swatch Group ${origin}/${lang}/job-finder: aucun lien /job/ — gabarit ou listing cassé`);

  /**
   * 2026-09-09 : 265 offres pour 267 liens, run après run, sans cause nommée.
   * Une fiche que le parseur ne lit pas ou que le réseau ne rend pas devient
   * une ligne REJETÉE avec son URL et sa cause — jamais un simple « −2 ».
   */
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const limit = pLimit(Number(config.concurrency ?? 4));
  const jobs = await Promise.all(
    links.map((url) =>
      limit(async () => {
        try {
          const job = parseSwatchJobPage(await fetchText(url), url);
          if (!job) rejectedRows.push({ reason: 'DETAIL_UNPARSED', raw: { url } });
          return job;
        } catch (error) {
          await log.error('adapter.detail_failed', `[swatchgroup] ${url}: ${(error as Error).message.slice(0, 120)}`, { error });
          rejectedRows.push({ reason: 'DETAIL_FETCH_FAILED', raw: { url, error: String(error).slice(0, 200) } });
          return null;
        }
      }),
    ),
  );
  const issues: string[] = [...shapeIssues];
  if (countingSweeps > 0) issues.push('RECONCILED_BY_SECOND_SWEEP');
  if (rejectedRows.length) issues.push('DETAILS_REJECTED');
  // The board is proven when the union of the reads reaches exactly the total the pager publishes, and every listed
  // link was read into a posting.
  const linksProven = publisherTotal !== undefined && seen.size === publisherTotal;
  const complete = linksProven && rejectedRows.length === 0;
  if (!complete) issues.push('ENUMERATION_NOT_PROVEN');
  const declaredTotal = publisherTotal ?? links.length;
  return { jobs: jobs.filter((job): job is NormalizedJob => job !== null), declaredTotal, complete, truncated: shapeIssues.includes('PAGE_BUDGET_EXHAUSTED'), rejectedRows,
    enumeration: { method: 'DRUPAL_PAGER_TOTAL_RECONCILED_THEN_EVERY_DETAIL', endpoint: `${origin}/${lang}/job-finder`, pages: pagesRead, rawCount: links.length, termination, issues,
      scopes: [{ scope: 'links', declaredTotal, uniqueIds: links.length, pages: pagesRead, complete: linksProven }, { scope: 'details', declaredTotal: links.length, uniqueIds: links.length - rejectedRows.length, pages: links.length, complete: rejectedRows.length === 0 }], pageEvidence } };
}
