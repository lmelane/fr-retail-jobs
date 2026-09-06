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
    raw: { source: 'swatchgroup', legalEntity: raw?.hiringOrganization?.name, logo, applyUrl, jsonLd: posting?.raw },
  };
}

export async function fetchSwatchGroupJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const origin = String(config.origin ?? DEFAULT_ORIGIN).replace(/\/$/, '');
  const lang = String(config.lang ?? DEFAULT_LANG);
  const maxPages = Number(config.maxPages ?? MAX_PAGES);

  const links: string[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const html = await fetchText(`${origin}/${lang}/job-finder?page=${page}`);
    // Chaque carte porte le lien 3 fois (image, titre, « En savoir plus ») :
    // dédoublonner dans la page, puis contre les pages déjà lues.
    const fresh = [...new Set([...html.matchAll(/href="(\/[a-z]{2}\/job\/\d+)"/g)].map((m) => `${origin}${m[1]}`))]
      .filter((link) => !seen.has(link));
    for (const link of fresh) {
      seen.add(link);
      links.push(link);
    }
    // Le pager Drupal rend la dernière page en boucle au-delà de la fin :
    // une page sans lien NOUVEAU termine la lecture (comme le générique).
    if (fresh.length === 0) break;
  }
  if (links.length === 0) throw new Error(`Swatch Group ${origin}/${lang}/job-finder: aucun lien /job/ — gabarit ou listing cassé`);

  const limit = pLimit(Number(config.concurrency ?? 4));
  const jobs = await Promise.all(
    links.map((url) =>
      limit(async () => {
        try {
          return parseSwatchJobPage(await fetchText(url), url);
        } catch (error) {
          console.error(`[swatchgroup] ${url}: ${(error as Error).message.slice(0, 120)}`);
          return null;
        }
      }),
    ),
  );

  return { jobs: jobs.filter((job): job is NormalizedJob => job !== null), declaredTotal: links.length };
}
