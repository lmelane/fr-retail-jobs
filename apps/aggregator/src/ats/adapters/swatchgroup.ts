import { isKnownPosting } from '../../lib/incrementalReading.js';
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
 * Le lien « Dernier » du pager Drupal, repéré par son icône (indépendante de la langue). Avec les champs du formulaire,
 * Drupal recopie la requête dans le lien : `href="?search_api_fulltext=&amp;…&amp;time=All&amp;page=33" aria-label="Dernier">
 * <span aria-hidden="true"><i class="icon--last">`.
 */
const LAST_PAGE_LINK = /href="\?(?:[^"]*?&amp;)?page=(\d+)"[^>]*>\s*<span[^>]*>\s*<i class="icon--last"/;
/** Les numéros du pager. Sans lien « Dernier » (cinq pages ou moins, mesuré le 02/10), le plus grand est la dernière. */
const PAGE_LINKS = /class="page-link" href="\?(?:[^"]*?&amp;)?page=(\d+)"/g;
/**
 * Les champs du formulaire de recherche à leur valeur « - Tout - », tels que le bouton « Rechercher » les envoie sans
 * filtre ; seul `time` varie (voir plus bas). Ils ne restreignent rien : 331 offres annoncées le 02/10/2026 avec ou sans.
 */
const FORM_DEFAULTS = 'search_api_fulltext=&jf_country=All&domain=All&position=All&contract=All';
/** Le filtre public qui partitionne le listing : « Plein temps » / « Temps partiel » (274 + 57 = 331 le 02/10/2026). */
const PARTITION_FILTER = 'time';

/** Les valeurs d'un `<select name=…>` du formulaire, « All » exclu, dans l'ordre de la page. Exporté pour être testé. */
export function selectOptionValues(html: string, name: string): string[] {
  const select = html.match(new RegExp(`<select[^>]*\\bname="${name}"[^>]*>([\\s\\S]*?)</select>`, 'i'))?.[1];
  if (!select) return [];
  return [...select.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]).filter((value) => value !== '' && value !== 'All');
}

/**
 * La dernière page annoncée : le lien « Dernier », sinon le plus grand numéro du pager, sinon 0 (une seule page, sans
 * pager). Exporté pour être testé sur les pages réelles.
 */
export function announcedLastPage(html: string): { lastIndex: number; viaLastLink: boolean } {
  const last = LAST_PAGE_LINK.exec(html)?.[1];
  if (last !== undefined) return { lastIndex: Number(last), viaLastLink: true };
  return { lastIndex: Math.max(0, ...[...html.matchAll(PAGE_LINKS)].map((m) => Number(m[1]))), viaLastLink: false };
}

/** Une lecture complète du listing pour une valeur du filtre (« All » : le listing entier). `total` : absent si sa forme ne tient pas. */
type Sweep = { value: string; total?: number; ids: Set<string>; pages: number; shapeIssues: string[]; firstPage: string };

export async function fetchSwatchGroupJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? DEFAULT_ORIGIN).replace(/\/$/, '');
  const lang = String(config.lang ?? DEFAULT_LANG);
  const maxPages = Number(config.maxPages ?? MAX_PAGES);

  const links: string[] = [];
  const seen = new Set<string>();
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  let pagesRead = 0;
  let pageSize = 0;
  const listUrl = (value: string, page: number) => `${origin}/${lang}/job-finder?page=${page}&${FORM_DEFAULTS}&${PARTITION_FILTER}=${value}`;

  /*
   * D-493 (02/10/2026) : LE LISTING COMPLET, PUIS LE MÊME LISTING PARTITIONNÉ PAR UN FILTRE PUBLIC DU FORMULAIRE.
   *
   * Mesuré le 02/10/2026 entre 04:49 et 05:10 UTC (`audits/2026-10-02/d493-swatch/`) :
   *  1. Les pages `?page=N` sont mises en cache par Akamai (`server-timing: cdn-cache; desc=HIT`) malgré
   *     `cache-control: private, no-cache`, chacune à son heure et sur chaque serveur de bord : une lecture mêle des
   *     états du listing d'âges différents (pages 3 et 7 annonçant 32 pages quand les autres en annonçaient 33, six
   *     offres servies deux fois). C'est la cause des totaux qui différaient d'une langue à l'autre (fr 350, en 360,
   *     de 360, it 344 le 30/09) et du `PUBLISHER_TOTAL_CHANGED` qui a mis la source en pause.
   *  2. Lu à l'origine (`desc=MISS`), le listing est le même dans toutes les langues : en français et en anglais,
   *     mêmes 331 annoncées, même ordre, mêmes liens. Relire une autre langue ne montre donc rien de nouveau.
   *  3. Mais l'origine elle-même ne sert pas tout : son ordre a des égalités, et deux offres glissent d'une page à la
   *     suivante (servies deux fois) en en cachant deux autres (33253, 33295) : 329 distinctes pour 331 annoncées, à
   *     chaque lecture complète.
   *  4. Partitionné par le filtre « temps de travail » du même formulaire, chaque sous-listing a ses propres
   *     frontières de page : 274 + 57 = 331 annoncées, 274 et 57 distinctes, aucune offre dans les deux, et leur union
   *     avec le listing complet compte exactement 331. Deux lectures complètes (04:56 et 05:06 UTC) rendent la même
   *     union.
   *
   * La preuve, donc, sans aucune relecture dans une autre langue :
   *  - chaque lecture (complète, puis chaque valeur du filtre) a sa forme : pages pleines sauf la dernière, la suivante
   *    vide, et chaque page qui porte un lien « Dernier » annonce la même dernière page que la page 0 de sa lecture
   *    (une page servie d'un autre état du listing n'a pas le même total) ;
   *  - la somme des totaux des partitions égale le total du listing complet : deux lectures du même ensemble, prises à
   *    quelques secondes d'écart, doivent se recouper (une offre ajoutée ou retirée entre elles les fait diverger) ;
   *  - aucune offre n'appartient à deux partitions ;
   *  - l'union de toutes les lectures compte exactement le total du listing complet.
   * Chaque lecture est faite en entier quel que soit le résultat des précédentes : l'ensemble des requêtes de listing
   * ne dépend que des pages 0 (leçon ACCESS_SCOPE du RUN du 30/09). Les champs du formulaire sont envoyés à leur valeur
   * « Tout », comme le bouton Rechercher, et `time` prend « All » puis chaque valeur de la liste du formulaire.
   */
  const sweep = async (value: string): Promise<Sweep> => {
    const result: Sweep = { value, ids: new Set(), pages: 0, shapeIssues: [], firstPage: '' };
    const read = async (page: number) => {
      const url = listUrl(value, page);
      const html = await fetchText(url);
      const inPage = new Map<string, string>();
      // Chaque carte porte le lien 3 fois (image, titre, « En savoir plus ») ; le préfixe de langue varie d'une offre à
      // l'autre (en, fr, de, it sur la même page) : on dédoublonne par l'identifiant de l'offre, jamais par l'adresse.
      for (const m of html.matchAll(/href="(\/[a-z]{2}\/job\/(\d+))"/g)) if (!inPage.has(m[2])) inPage.set(m[2], `${origin}${m[1]}`);
      const fresh = [...inPage].filter(([id]) => !seen.has(id));
      for (const [id, link] of fresh) { seen.add(id); links.push(link); }
      for (const id of inPage.keys()) result.ids.add(id);
      pagesRead += 1; result.pages += 1;
      const announced = LAST_PAGE_LINK.exec(html)?.[1];
      pageEvidence.push({ url, checkedAt: captureObservedAt().toISOString(), sha256: createHash('sha256').update(html).digest('hex'), offset: page, pagination: null,
        ids: [...inPage.keys()], publisherCounter: announced === undefined ? '' : `lastPage=${announced}`,
        componentCounters: [`${PARTITION_FILTER}=${value}`, `links=${inPage.size}`, `fresh=${fresh.length}`, `uniqueLinks=${seen.size}`] });
      return { html, count: inPage.size, announced: announced === undefined ? undefined : Number(announced) };
    };
    const first = await read(0);
    result.firstPage = first.html;
    if (value === 'All') pageSize = first.count;
    const { lastIndex } = announcedLastPage(first.html);
    if (lastIndex + 1 >= maxPages) {
      result.shapeIssues.push('PAGE_BUDGET_EXHAUSTED');
      for (let page = 1; page < maxPages; page += 1) await read(page);
      return result;
    }
    let lastCount = lastIndex === 0 ? first.count : 0;
    let shapeHolds = lastIndex === 0 ? first.count <= pageSize : first.count === pageSize;
    let sameAnnouncement = true;
    for (let page = 1; page <= lastIndex; page += 1) {
      const { count, announced } = await read(page);
      if (page < lastIndex ? count !== pageSize : count < 1 || count > pageSize) shapeHolds = false;
      if (announced !== undefined && announced !== lastIndex) sameAnnouncement = false;
      if (page === lastIndex) lastCount = count;
    }
    const beyond = await read(lastIndex + 1);
    if (!shapeHolds) result.shapeIssues.push('PAGE_SIZE_INCONSISTENT');
    if (!sameAnnouncement) result.shapeIssues.push('LAST_PAGE_ANNOUNCEMENT_CHANGED');
    if (beyond.count !== 0) result.shapeIssues.push('PAGE_BEYOND_LAST_NOT_EMPTY');
    if (result.shapeIssues.length === 0) result.total = lastIndex * pageSize + lastCount;
    return result;
  };

  const full = await sweep('All');
  if (links.length === 0) throw new Error(`Swatch Group ${origin}/${lang}/job-finder: aucun lien /job/ — gabarit ou listing cassé`);
  const partitionValues = selectOptionValues(full.firstPage, PARTITION_FILTER);
  const partitions: Sweep[] = [];
  for (const value of partitionValues) partitions.push(await sweep(value));

  const shapeIssues = [...new Set([full, ...partitions].flatMap((s) => s.shapeIssues))];
  const proofIssues: string[] = [];
  const publisherTotal = full.total;
  if (partitionValues.length === 0) proofIssues.push('PARTITION_FILTER_ABSENT');
  const partitionSum = partitions.reduce((n, p) => n + (p.total ?? Number.NaN), 0);
  if (partitionValues.length > 0 && publisherTotal !== undefined && partitionSum !== publisherTotal) proofIssues.push('PARTITION_TOTALS_DIFFER');
  const owner = new Map<string, string>();
  const overlaps = new Set<string>();
  for (const p of partitions) for (const id of p.ids) { if (owner.has(id)) overlaps.add(id); else owner.set(id, p.value); }
  if (overlaps.size) proofIssues.push('PARTITION_OVERLAP');
  if (publisherTotal !== undefined && seen.size !== publisherTotal) proofIssues.push(seen.size > publisherTotal ? 'UNION_ABOVE_PUBLISHER_TOTAL' : 'PUBLISHER_TOTAL_NOT_REACHED');
  const linksProven = publisherTotal !== undefined && shapeIssues.length === 0 && proofIssues.length === 0;
  const termination = linksProven ? 'PARTITIONS_RECONCILED'
    : shapeIssues.includes('PAGE_BUDGET_EXHAUSTED') ? 'PAGE_BUDGET_EXHAUSTED'
    : full.shapeIssues.includes('PAGE_BEYOND_LAST_NOT_EMPTY') ? 'PAGE_BEYOND_LAST_NOT_EMPTY' : 'PARTITIONS_NOT_RECONCILED';

  /**
   * 2026-09-09 : 265 offres pour 267 liens, run après run, sans cause nommée.
   * Une fiche que le parseur ne lit pas ou que le réseau ne rend pas devient
   * une ligne REJETÉE avec son URL et sa cause — jamais un simple « −2 ».
   */
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const limit = pLimit(Number(config.concurrency ?? 4));
  // L'identifiant de la fiche, le même que `parseSwatchJobPage` donne à l'offre : une ligne rejetée reste NOMMÉE (D-508 §6).
  const canonicalIdOf = (url: string) => url.match(/\/job\/(\d+)$/)?.[1];
  const jobs = await Promise.all(
    // D-517 : en lecture incrémentale, la fiche n'est lue que pour une offre jamais vue.
    links.filter((url) => !isKnownPosting(canonicalIdOf(url))).map((url) =>
      limit(async () => {
        const canonicalId = canonicalIdOf(url);
        try {
          const job = parseSwatchJobPage(await fetchText(url), url);
          if (!job) rejectedRows.push({ reason: 'DETAIL_UNPARSED', raw: { url }, ...(canonicalId ? { canonicalId } : {}) });
          return job;
        } catch (error) {
          await log.error('adapter.detail_failed', `[swatchgroup] ${url}: ${(error as Error).message.slice(0, 120)}`, { error });
          rejectedRows.push({ reason: 'DETAIL_FETCH_FAILED', raw: { url, error: String(error).slice(0, 200) }, ...(canonicalId ? { canonicalId } : {}) });
          return null;
        }
      }),
    ),
  );
  const issues: string[] = [...shapeIssues, ...proofIssues];
  if (rejectedRows.length) issues.push('DETAILS_REJECTED');
  // The board is proven when every read holds its shape, the partitions add up to the full total, never share an
  // offer, and the union of the reads reaches exactly that total; and every listed link was read into a posting.
  const complete = linksProven && rejectedRows.length === 0;
  if (!complete) issues.push('ENUMERATION_NOT_PROVEN');
  const declaredTotal = publisherTotal ?? links.length;
  /*
   * D-508 §6 (02/10/2026) : LES IDENTIFIANTS CANONIQUES, SEULEMENT QUAND L'ÉNUMÉRATION EST PROUVÉE.
   *
   * Sans `canonicalIds`, le refresh tient la source pour `UNVERIFIABLE` (`pipeline/refreshPlan.ts`) : une offre
   * retirée du site restait en ligne, 380 au catalogue pour 331 publiées le 02/10. Les identifiants d'une page sont
   * ceux de ses liens `/job/<id>`, le chemin même de `externalId` (`parseSwatchJobPage`). Ils ne sont déclarés que si
   * la preuve tient (`linksProven` : formes, somme des partitions, partitions disjointes, union égale au total), et
   * alors sur TOUTES les pages : une lecture non prouvée ne déclare rien et ne peut faire disparaître aucune offre,
   * en plus de sa terminaison non probante. La fermeture exige encore `complete` (toutes les fiches lues) et le reste
   * des conditions du refresh.
   */
  const evidence = linksProven ? pageEvidence.map((page) => ({ ...page, canonicalIds: [...page.ids] })) : pageEvidence;
  return { jobs: jobs.filter((job): job is NormalizedJob => job !== null), declaredTotal, complete, truncated: shapeIssues.includes('PAGE_BUDGET_EXHAUSTED'), rejectedRows,
    enumeration: { method: 'DRUPAL_PAGER_TOTAL_PARTITIONED_THEN_EVERY_DETAIL', endpoint: `${origin}/${lang}/job-finder`, pages: pagesRead, rawCount: links.length, termination, issues,
      scopes: [
        { scope: 'links', declaredTotal, uniqueIds: links.length, pages: pagesRead, complete: linksProven },
        ...[full, ...partitions].map((s) => ({ scope: `listing:${PARTITION_FILTER}=${s.value}`, declaredTotal: s.total ?? s.ids.size, uniqueIds: s.ids.size, pages: s.pages, complete: s.total !== undefined && s.ids.size === s.total })),
        { scope: 'details', declaredTotal: links.length, uniqueIds: links.length - rejectedRows.length, pages: links.length, complete: rejectedRows.length === 0 },
      ], pageEvidence: evidence } };
}
