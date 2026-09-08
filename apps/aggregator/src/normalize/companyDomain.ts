import { parse } from 'tldts';
import { fetchJson } from '../lib/http.js';
import { resolveCompany } from './company.js';

/**
 * Le domaine d'une Maison — pour son logo (le favicon du domaine).
 *
 * Constat de Loïc (2026-09-06) : « les pictogrammes des entreprises ne
 * correspondent pas aux entreprises ». Cause : le site DEVINAIT le domaine
 * depuis le nom (« MAC » → mac.com, « Omega » → omega.com), et un nom devine
 * souvent le domaine réel d'une AUTRE entreprise. Aucune validation ne peut
 * détecter « mauvaise entreprise » : le favicon existe, il est juste faux.
 *
 * Ici le domaine vient toujours d'une source qui NOMME la Maison :
 *   (i)  le catalogue — la racine du domaine carrière d'une source employeur
 *        dont la Maison est cette Company (sans réseau, écrit à l'ingest) ;
 *   (ii) Wikidata — l'entité dont la description dit « entreprise / marque de
 *        luxe… », propriété P856 (site officiel) ;
 *   (iii) rien — et le site montre l'initiale. Jamais un logo faux.
 */

export type DomainSource = 'source-careers' | 'wikidata' | 'manual';

export type ResolvedDomain = { domain: string; domainSource: DomainSource };

/** Ce qu'il faut d'une ligne du catalogue pour le chemin (i). */
export type EmployerSourceLike = {
  maison: string;
  tier: string;
  careersDomain: string | null | undefined;
};

/**
 * Les tiers dont le domaine carrière est celui de la Maison elle-même :
 * son site (EMPLOYER_DIRECT) ou son propre tenant ATS (ATS_OFFICIAL — la ligne
 * nomme la Maison et son hôte carrière, même garantie). Un jobboard ou un
 * agrégateur porte le domaine du board, jamais celui de l'employeur.
 */
const EMPLOYER_OWNED_TIERS = new Set(['EMPLOYER_DIRECT', 'ATS_OFFICIAL']);

/** Un hôte simple : lettres, chiffres, tirets et points. Rien d'autre. */
const HOST_RE = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/;

/**
 * Domaines des éditeurs d'ATS et des jobboards : un hôte qui y appartient est
 * l'hôte du vendeur, pas celui de la Maison. Rendre `richemont.wd3.
 * myworkdayjobs.com` → « myworkdayjobs.com » mettrait le logo Workday sur
 * toutes les Maisons Richemont. Donc : aucun domaine, pas un faux.
 */
const ATS_HOST_SUFFIXES = [
  'myworkdayjobs.com', 'myworkday.com', 'icims.com', 'teamtailor.com', 'oraclecloud.com',
  'taleo.net', 'successfactors.com', 'successfactors.eu', 'sapsf.com', 'sapsf.eu',
  'avature.net', 'lever.co', 'greenhouse.io', 'smartrecruiters.com', 'personio.de',
  'personio.com', 'recruitee.com', 'talent-soft.com', 'talentview.io', 'workable.com',
  'jobylon.com', 'ashbyhq.com', 'eightfold.ai', 'phenom.com', 'breezy.hr', 'bamboohr.com',
  'applytojob.com', 'jobvite.com', 'ultipro.com', 'brassring.com', 'csod.com',
  'cornerstoneondemand.com', 'pinpointhq.com', 'digitalrecruiters.com', 'talentlyft.com',
  'dayforcehcm.com', 'paylocity.com', 'jobs.net', 'welcometothejungle.com', 'fashionjobs.com',
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'flatchr.io', 'werecruit.io',
];

/**
 * Mots de carrière qu'un label peut porter à la place d'un sous-domaine :
 * `carrieres-rolex.com`, `recrutement-nocibe.fr`, `burberrycareers.com`. Le
 * label restant doit garder au moins 3 caractères, sinon c'était le nom.
 */
const CAREER_WORD = '(?:careers?|carrieres?|jobs?|recrutement|emplois?|talents?|recrute)';
const LEADING_CAREER = new RegExp(`^${CAREER_WORD}-?(.{3,})$`);
const TRAILING_CAREER = new RegExp(`^(.{3,}?)-?${CAREER_WORD}$`);

function stripCareerWord(label: string): string {
  return label.replace(LEADING_CAREER, '$1').replace(TRAILING_CAREER, '$1');
}

/**
 * La racine (domaine enregistrable) d'un hôte carrière : tout sous-domaine
 * tombe — `careers.`, `jobs.`, `carrieres.`, `recrutement.`, `talent.`,
 * `hub-…`, `www.` et les autres, sans liste à tenir — et un hôte ATS ne rend
 * rien. Accepte une URL ou un hôte avec port.
 *
 * Le suffixe public vient de la Public Suffix List (tldts, embarquée, sans
 * réseau) : une liste maison de 18 suffixes réduisait `x.co.id` à « co.id »
 * — mesuré en prod le 2026-09-06, URBN affichait un logo pour « co.id ».
 */
export function rootDomainOf(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  let host = trimmed;
  try {
    host = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }
  if (!HOST_RE.test(host)) return null;
  if (ATS_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return null;

  const parsed = parse(host);
  if (parsed.isIp || !parsed.domain || !parsed.publicSuffix) return null;
  const suffix = parsed.publicSuffix;
  const label = stripCareerWord(parsed.domain.slice(0, -(suffix.length + 1)));
  if (!label) return null;
  return `${label}.${suffix}`;
}

/** Lettres et chiffres seulement, sans accents : la forme comparable d'un nom ou d'un label. */
function alnum(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Le domaine porte-t-il le nom de la Maison ? Un flux de groupe est catalogué
 * sous sa marque de tête avec le domaine du GROUPE (« Element +6 » →
 * groupe-beaumanoir.com, « Escada Parfums +16 » → coty.com) : crédité tel
 * quel, le logo Beaumanoir s'affiche sur Element. On exige que le label du
 * domaine contienne le nom (ou l'inverse), ou un mot du nom d'au moins trois
 * lettres — « footlocker » porte « locker », « thehoffbrand » porte « hoff ».
 */
export function nameMatchesDomain(name: string, domain: string): boolean {
  const label = alnum(domain.split('.')[0] ?? '');
  const compact = alnum(name);
  if (!label || !compact) return false;
  if (label.includes(compact) || compact.includes(label)) return true;
  const words = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
  return words.some((word) => label.includes(word));
}

/** La Maison d'une ligne du catalogue, comme l'ingest la lit (« Kering (toutes Maisons) » → Kering). */
function maisonOf(source: EmployerSourceLike): string {
  return source.maison.split('(')[0].trim();
}

/**
 * Chemin (i) : la racine du domaine carrière d'une source employeur dont la
 * Maison résout (resolveCompany) à cette Company. Sans réseau — c'est ce que
 * l'ingest écrit à chaque création ou ré-attestation d'une Company.
 */
export function domainFromEmployerSources(companyKey: string, sources: readonly EmployerSourceLike[]): string | null {
  const candidates = sources
    .filter((source) => EMPLOYER_OWNED_TIERS.has(source.tier))
    // Le site de la Maison avant son tenant ATS, quand les deux existent.
    .sort((a, b) => Number(b.tier === 'EMPLOYER_DIRECT') - Number(a.tier === 'EMPLOYER_DIRECT'));
  for (const source of candidates) {
    const maison = maisonOf(source);
    if (resolveCompany(maison).companyId !== companyKey) continue;
    const domain = rootDomainOf(source.careersDomain);
    if (domain && nameMatchesDomain(maison, domain)) return domain;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Chemin (ii) — Wikidata
// ---------------------------------------------------------------------------

export type WikidataSearchEntity = { id: string; label?: string; description?: string };
export type WikidataSearchResponse = { search: WikidataSearchEntity[] };
export type WikidataClaim = { rank: string; mainsnak: { datavalue?: { value?: unknown } } };
export type WikidataClaimsResponse = { claims: Record<string, WikidataClaim[] | undefined> };

/** Les deux appels Wikidata, injectables : les tests rejouent des fixtures capturées. */
export type WikidataClient = {
  search(term: string, language: 'fr' | 'en'): Promise<WikidataSearchResponse>;
  officialWebsite(entityId: string): Promise<WikidataClaimsResponse>;
};

/** Formes juridiques et mots de structure qu'une encyclopédie ne met pas dans son libellé. */
const LEGAL_FORM =
  /[,\s]+(?:inc\.?|llc|ltd\.?|limited|plc|pty\.? ltd\.?|gmbh(?: & co\.? kg)?|ag|s\.?a\.?s\.?u?|s\.?a\.?r\.?l\.?|s\.?a\.?|s\.?r\.?l\.?|s\.?p\.?a\.?|b\.?v\.?|n\.?v\.?|co\.? kg|& co\.? kg|corp\.?|corporation)\s*$/i;

/**
 * Le terme à chercher : le nom sans sa forme juridique (« Ulta Beauty, Inc. »
 * → « Ulta Beauty »). Rechercher ensuite le nom brut n'apporterait rien — une
 * encyclopédie ne libelle pas « Inc. » — et coûterait une requête par langue.
 * Une liste, pour qu'un terme vide (nom réduit à sa forme juridique) ne
 * déclenche aucune recherche.
 */
export function wikidataSearchTerms(name: string): string[] {
  let cleaned = name.replace(/\s+/g, ' ').trim();
  // Plusieurs formes peuvent s'empiler (« MANGO MNG, S.A. » ; « Laverana GmbH & Co. KG »).
  for (let i = 0; i < 3; i++) cleaned = cleaned.replace(LEGAL_FORM, '').replace(/[,\s]+$/, '').trim();
  return cleaned.length >= 2 ? [cleaned] : [];
}

/**
 * Ce qu'une description doit dire pour être une Maison de notre secteur.
 *
 * Deux familles : les mots du secteur (mode, luxe, beauté, horlogerie…) et
 * les mots qui disent « c'est une entreprise ». Les seconds sont volontairement
 * restreints : « groupe » couvre le « groupe de rock hongrois » d'Omega,
 * « maison » la maison d'édition, « label » le label discographique — ils ne
 * comptent qu'avec un mot du secteur. « styliste » n'y est pas : Tom Ford le
 * styliste n'est pas Tom Ford la maison.
 */
const SECTOR_WORDS = [
  'fashion', 'luxury', 'beauty', 'cosmetic', 'perfume', 'fragrance', 'watch', 'jewel', 'jewell',
  'retail', 'clothing', 'apparel', 'footwear', 'shoe', 'eyewear', 'leather', 'lingerie',
  'department store', 'skincare', 'sportswear', 'textile', 'haute couture', 'ready-to-wear',
  'mode', 'luxe', 'beaute', 'cosmetique', 'parfum', 'horlog', 'joaill', 'bijou', 'pret-a-porter',
  'couture', 'chaussure', 'maroquinerie', 'lunett', 'grand magasin', 'vetement', 'lingerie',
  'soins', 'accessoire', 'moda', 'lusso', 'gioiell', 'orolog', 'cosmetici', 'abbigliamento',
];
const COMPANY_WORDS = [
  'entreprise', 'enterprise', 'company', 'societe', 'marque', 'brand', 'fabricant', 'manufacturer',
  'retailer', 'corporation', 'business', 'chaine de magasins', 'chain of stores', 'store chain',
  'conglomerate', 'conglomerat', 'azienda', 'impresa', 'empresa',
];
const SECTOR_RE = new RegExp(SECTOR_WORDS.map(escapeRe).join('|'));
const COMPANY_RE = new RegExp(`\\b(?:${COMPANY_WORDS.map(escapeRe).join('|')})`);

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function comparable(text: string): string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function entityScore(entity: WikidataSearchEntity): number {
  const description = comparable(entity.description ?? '');
  if (!description) return 0;
  const sector = SECTOR_RE.test(description) ? 2 : 0;
  const company = COMPANY_RE.test(description) ? 1 : 0;
  return sector + company;
}

/**
 * Les entités qui peuvent être la Maison, la plus probable d'abord.
 *
 * Une entité sans note (le prénom, la station de métro, le système
 * d'exploitation) est écartée : son site officiel n'est pas le nôtre. Parmi
 * les autres, le LIBELLÉ EXACT prime sur la note — mesuré en prod : pour
 * « Louis Vuitton », LVMH (« groupe … d'entreprises de luxe ») notait plus
 * haut que la maison (« maison … de maroquinerie de luxe ») et le logo du
 * groupe s'affichait sur Louis Vuitton. Puis la note, puis l'ordre Wikidata.
 */
export function rankWikidataEntities(entities: readonly WikidataSearchEntity[], term: string): WikidataSearchEntity[] {
  const wanted = comparable(term).replace(/\s+/g, ' ').trim();
  const scored = entities
    .map((entity, order) => ({
      entity,
      order,
      score: entityScore(entity),
      exact: comparable(entity.label ?? '').replace(/\s+/g, ' ').trim() === wanted,
    }))
    .filter((row) => row.score > 0);
  const exactOnly = scored.some((row) => row.exact) ? scored.filter((row) => row.exact) : scored;
  return exactOnly.sort((a, b) => b.score - a.score || a.order - b.order).map((row) => row.entity);
}

/** La première entité de `rankWikidataEntities`, ou null. */
export function pickWikidataEntity(entities: readonly WikidataSearchEntity[], term: string): WikidataSearchEntity | null {
  return rankWikidataEntities(entities, term)[0] ?? null;
}

const RANK_ORDER: Record<string, number> = { preferred: 0, normal: 1 };

/**
 * Le domaine du site officiel (P856) : `preferred` avant `normal`, jamais
 * `deprecated`, et ramené à la racine — Louis Vuitton déclare 43 sites
 * régionaux (`fr.louisvuitton.com`…) pour un seul domaine.
 */
export function hostFromOfficialWebsite(claims: WikidataClaimsResponse): string | null {
  const sites = (claims.claims.P856 ?? [])
    .filter((claim) => claim.rank in RANK_ORDER)
    .sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank]);
  for (const claim of sites) {
    const value = claim.mainsnak.datavalue?.value;
    if (typeof value !== 'string') continue;
    const domain = rootDomainOf(value);
    if (domain) return domain;
  }
  return null;
}

/** Entités dont on lit le site par recherche : deux, la plus probable puis sa suivante. */
const CLAIMS_READS_PER_SEARCH = 2;

/**
 * Chemin (ii) : le nom → les entités qui peuvent être la Maison (fr puis en)
 * → le site officiel de la première qui en déclare un. Une entité sans P856
 * (« Christian Dior Couture » n'en a pas) cède la place à la suivante ; sans
 * suivante, rien — on ne remonte jamais au groupe (P749 : LVMH), dont le logo
 * n'est pas celui de la Maison.
 *
 * Le domaine retenu doit PORTER LE NOM, comme sur le chemin catalogue : une
 * recherche par nom rend des homonymes que la description ne suffit pas à
 * écarter — mesuré en prod le 2026-09-06 : « URBN » → Urban Jakarta
 * Propertindo (« Indonesian company »), « Towa » → une société savante
 * polonaise, « Wing » → x.company, « Dunhill » → bat.com. Un domaine sans le
 * nom cède la place à l'entité suivante ; sans suivante, rien (l'initiale).
 */
export async function resolveViaWikidata(name: string, client: WikidataClient): Promise<string | null> {
  for (const term of wikidataSearchTerms(name)) {
    for (const language of ['fr', 'en'] as const) {
      const response = await client.search(term, language);
      const ranked = rankWikidataEntities(response.search ?? [], term).slice(0, CLAIMS_READS_PER_SEARCH);
      for (const entity of ranked) {
        const domain = hostFromOfficialWebsite(await client.officialWebsite(entity.id));
        if (domain && nameMatchesDomain(term, domain)) return domain;
      }
    }
  }
  return null;
}

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
/** Politesse Wikidata : au plus une requête par seconde, et un agent qui se nomme. */
const WIKIDATA_MIN_GAP_MS = 1_000;
const WIKIDATA_USER_AGENT = 'ModeCareersBot/1.0 (https://modecareers.com; loic.melane@catwalks.io)';

/** Le client réel : `fetchJson` (porte par hôte, garde SSRF) + un intervalle d'une seconde. */
export function wikidataClient(): WikidataClient {
  let nextAllowedAt = 0;
  async function call<T>(params: Record<string, string>): Promise<T> {
    const wait = nextAllowedAt - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    nextAllowedAt = Date.now() + WIKIDATA_MIN_GAP_MS;
    const url = `${WIKIDATA_API}?${new URLSearchParams({ ...params, format: 'json' })}`;
    return fetchJson<T>(url, { headers: { 'user-agent': WIKIDATA_USER_AGENT } });
  }
  return {
    search: (term, language) =>
      call<WikidataSearchResponse>({
        action: 'wbsearchentities', search: term, language, uselang: language, type: 'item', limit: '7',
      }),
    officialWebsite: (entityId) => call<WikidataClaimsResponse>({ action: 'wbgetclaims', entity: entityId, property: 'P856' }),
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type CompanyLike = { name: string; canonicalKey: string };

/**
 * (i) le catalogue, sinon (ii) Wikidata, sinon null. Le nom de recherche est
 * le nom AFFICHÉ (déjà résolu, D11) : « Christian Dior Couture », pas
 * « Dior +3 ». `canonicalKey` est la clé de résolution stockée sur la Company.
 */
export async function resolveCompanyDomain(
  company: CompanyLike,
  sources: readonly EmployerSourceLike[],
  wikidata: WikidataClient,
): Promise<ResolvedDomain | null> {
  const fromCatalogue = domainFromEmployerSources(company.canonicalKey, sources);
  if (fromCatalogue) return { domain: fromCatalogue, domainSource: 'source-careers' };
  const fromWikidata = await resolveViaWikidata(company.name, wikidata);
  if (fromWikidata) return { domain: fromWikidata, domainSource: 'wikidata' };
  return null;
}
