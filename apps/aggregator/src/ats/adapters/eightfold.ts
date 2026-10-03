import { isKnownPosting } from '../../lib/incrementalReading.js';
import { createHash } from 'node:crypto';
import { captureObservedAt } from '../../capture/context.js';
import { log } from '../../observability/logger.js';
import pLimit from 'p-limit';
import { fetchJson, fetchWithRetry } from '../../lib/http.js';
import { assertSourceRunning, sourceDelay } from '../../lib/sourceBudget.js';
import { htmlToPlainText } from '../../lib/html.js';
import { employmentTermsFrom, readEmployment } from '../../normalize/employment.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { CRAWLER_IDENTITY } from '../../lib/crawlerIdentity.js';

/**
 * Eightfold AI career sites (Estée Lauder and its Maisons).
 *
 * Its `/api/pcsx/` endpoints are explicitly allowed by robots.txt —
 * `Disallow: /` with `Allow: /careers`, `Allow: /api/apply`, `Allow: /api/pcsx`
 * — so this is the route the site itself invites.
 *
 * Two things cost time to find and are worth recording: the older
 * /api/apply/v2/jobs path 403s regardless of headers, and /api/pcsx/search needs
 * a session cookie from the careers page first (a bare request 403s in a way
 * that reads like a blocked endpoint rather than a missing cookie).
 *
 * Verified 2026-09-01 on careers.elcompanies.com: count 1400, positions carrying
 * id, name, locations and postedTs. The listing has no description, so
 * /api/pcsx/position_details supplies it per offer.
 */

/**
 * The API pins its page to 10 regardless of `num`, `size` or `pageSize`; only
 * `start` advances. So a 1400-offer board is 140 requests — small pages, but the
 * only shape it offers.
 */
const PAGE_SIZE = 10;
const MAX_PAGES = Number(process.env.EIGHTFOLD_MAX_PAGES ?? 300);
/** Relectures complètes de la liste après les pages ciblées, quand une répétition a caché une position (voir plus bas). */
const RECONCILIATION_SWEEPS = 1;

/**
 * LA FENÊTRE DU PARE-FEU D'EIGHTFOLD (mesurée le 30/09/2026 sur le RUN du 29/09, lecture seule).
 *
 * Le pare-feu d'Eightfold répond 405 (`x-amzn-waf-action: captcha`) à tout, Estée Lauder et Kering ENSEMBLE,
 * quand leur cumul dépasse environ 1 000 requêtes sur cinq minutes glissantes, et lève le refus quand ce cumul
 * repasse sous le seuil : trois fenêtres le 29/09, de 2 min 16 s à 2 min 49 s du premier au dernier refus, ouvertes
 * et levées dans les mêmes secondes pour les deux sources. Les trois essais du transport (0,5 s puis 1 s
 * d'écart) tombent tous dedans : 14 fiches Estée Lauder et 9 fiches Kering perdues (trois 405 de suite, ou un 429
 * puis deux 405), chacune sans description (refusée à la qualification) et, chez Kering, sans Maison (refusée à
 * l'identité). Le 28/09, c'est une PAGE DE LISTE Kering (start=700) qui y est tombée : la collecte entière a échoué.
 *
 * La cadence commune (`lib/rateLimitKey.ts`, `tenant:eightfold`) doit empêcher la fenêtre de s'ouvrir ; ces
 * relectures rattrapent ce qui y tomberait encore. Une lecture en échec est relue UNE fois, quatre minutes après le
 * DERNIER échec : la fenêtre la plus longue mesurée (2 min 49 s) et une marge. Une fiche perdue tôt dans la collecte
 * est donc relue sans attente. Le rejeu hors réseau sert les réponses d'une même adresse dans l'ordre de leur
 * capture et n'attend jamais (`sourceDelay`) : il relit exactement ce que la collecte a relu.
 *
 * La décision de relire ne dépend que des échecs, jamais de l'horloge : elle ne consulte pas l'échéance douce
 * (`sourceDeadlineReached`), que le rejeu ignore — il relirait alors une fiche que la collecte n'a pas relue, et
 * échouerait sur une réponse absente. Une attente qui déborde tombe sous l'échéance dure, comme toute requête.
 */
const WAF_WINDOW_WAIT_MS = 240_000;
/**
 * Au-delà de 5 % des fiches (et d'au moins cinq), ce n'est plus une fenêtre de pare-feu mais un portail en panne :
 * tout relire allongerait la collecte sans rien sauver (1 890 fiches Estée Lauder, onze minutes à la cadence
 * commune). Elles restent alors des offres de liste, refusées à la qualification, comme avant.
 */
const DETAIL_REREAD_FLOOR = 5;
const DETAIL_REREAD_SHARE = 0.05;
/** Une position retirée entre la liste et sa fiche (404 : deux fiches Estée Lauder le 29/09) ne revient pas. */
const GONE = new Set([404, 410]);
const gone = (error: unknown) => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && GONE.has(status);
};
const brief = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 160);

const USER_AGENT =
  CRAWLER_IDENTITY;

type EightfoldPosition = {
  id?: number | string;
  displayJobId?: string;
  name?: string;
  /** The tenant's own label: "Bogota,CO-DC,Colombia", "Paris, France". */
  locations?: string[];
  /**
   * Live tenants (ELC, Kering) send STRINGS — "Bogotá, Bogota, CO", "England,GB"
   * — the ISO-2 country last. Read as objects, the country was lost on
   * 1 469/1 470 Estée Lauder offers (audit a4). The object form is kept for
   * tenants that still send it.
   */
  standardizedLocations?: Array<string | { city?: string; country?: string }>;
  postedTs?: number;
  positionUrl?: string;
  department?: string;
};

type SearchResponse = {
  data?: { positions?: EightfoldPosition[]; count?: number };
};

type DetailResponse = {
  data?: {
    /** The live API answers camelCase; older tenants snake_case. Read both. */
    jobDescription?: string;
    job_description?: string;
    positionUrl?: string;
    /**
     * Tenant-custom brand field — the Maison this offer belongs to. Verified
     * live on careers.elcompanies.com: efcustomTextBrand = ["Le Labo"].
     * Without it every ELC offer inherits the catalogue label (audit A-01).
     */
    efcustomTextBrand?: string[] | string;
    /** Kering's Maison field — verified live 2026-09-06: efcustomTextHouse = ["Bottega Veneta"]. */
    efcustomTextHouse?: string[] | string;
    brand?: string[] | string;
    business_unit?: string[] | string;
    /** ELC: "Fulltime-Regular" / "Fulltime-Temporary" — contract AND working time in one word. */
    efcustomTextAssignmentcat?: string[] | string;
    /** Kering: "Regular" / "Fixed Term". */
    efcustomTextWorkerSubtype?: string[] | string;
    custom_JD?: { data_fields?: { assignmentcat?: string[] | string } };
  };
};

/** First non-empty brand value, whatever shape the tenant uses. */
function brandOf(data: DetailResponse['data']): string | undefined {
  for (const value of [data?.efcustomTextBrand, data?.efcustomTextHouse, data?.brand, data?.business_unit]) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first && String(first).trim()) return String(first).trim();
  }
  return undefined;
}

/**
 * D-481 §3 (30/09/2026) — LA DESCRIPTION QUE L'ÉDITEUR LAISSE LUI-MÊME VIDE est une retenue sur la preuve de la
 * source : non publiée, non comptée dans la tolérance de la qualification. Une fiche que NOUS n'avons pas su lire
 * ne l'est jamais : ce motif ne se pose que sur une fiche LUE (réponse 200 décodée), dont la description est vide.
 *
 * Mesuré le 30/09/2026 sur la capture Estée Lauder du 29/09 (`scripts/ops/eightfold-descriptions.mts`, lecture
 * seule) : 44 offres sur 1 890 sans description utile. 16 fiches n'avaient pas été lues — 14 refusées par le
 * pare-feu (voir `WAF_WINDOW_WAIT_MS`), 2 positions retirées entre la liste et la fiche (404) ; les 28 autres
 * avaient été lues, et l'éditeur y publie l'une de trois formes vides :
 *   · `<div></div>` (2) ;
 *   · son gabarit à deux rubriques, titres `<h2></h2>` vides et contenus `<div></div>` vides (10) ;
 *   · le même gabarit titré « Description » et « Qualifications », sans rien dessous (16) — le texte lu faisait
 *     30 caractères, passait donc pour une description, et aurait été publié tel quel.
 * Relu en ligne le 30/09 : la fiche 1168275706359 rend, octet pour octet, le gabarit titré sans contenu ; la fiche
 * 1168275738003, refusée par le pare-feu le 29/09, porte 1 892 caractères de texte. Et la capture du 28/09, avec
 * ses propres fenêtres de refus, rend les mêmes vides : 27 des 28 sont identiques d'un jour à l'autre, la 28e
 * (1168275762891) n'était pas encore publiée le 28/09. Un vide lu (200, JSON) n'est pas un refus du pare-feu, qui
 * répond 405 en HTML.
 *
 * La règle est donc STRUCTURELLE : on retire les titres de rubrique (un `<h1>`…`<h6>` court) ; s'il ne reste aucun
 * texte, l'éditeur n'a rien publié sous ses rubriques. Un titre long reste un contenu. Un champ ABSENT ou d'un
 * autre type n'est pas une description vide : c'est un format qu'on ne sait pas lire (3 780 descriptions perdues
 * derrière une clé renommée, `health.ts`), il reste refusé en CONTENT_MISSING et compté. Seule une chaîne rendue
 * par l'éditeur prouve le vide.
 *
 * Le même lecteur sert le collecteur, le rejeu de `publication/recovery.ts` et la mesure : une seule définition.
 */
export const NATIVE_DESCRIPTION_EMPTY = 'NATIVE_DESCRIPTION_EMPTY';
const SECTION_HEADING_MAX_CHARS = 60;
export function nativeDescriptionEmpty(detail: unknown): boolean {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return false;
  const data = detail as NonNullable<DetailResponse['data']>;
  // La même lecture que le collecteur : la clé actuelle, puis l'ancienne.
  const html = data.jobDescription ?? data.job_description;
  if (typeof html !== 'string') return false;
  const body = html.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (heading: string, _level: string, inner: string) =>
    (htmlToPlainText(inner) ?? '').length <= SECTION_HEADING_MAX_CHARS ? ' ' : heading);
  return !htmlToPlainText(body);
}

/** The contract / working-time words the tenant publishes on the detail (l2). */
function termsOf(data: DetailResponse['data']): string | undefined {
  return employmentTermsFrom([
    data?.efcustomTextAssignmentcat,
    data?.efcustomTextWorkerSubtype,
    data?.custom_JD?.data_fields?.assignmentcat,
  ]);
}

/**
 * Where the offer is, from the two location fields the search returns.
 *
 * Verified live 2026-09-06 — ELC: locations ["London,GB-LND,United Kingdom"],
 * standardizedLocations ["England,GB"]; Kering: ["Paris, France"] /
 * ["Paris, IDF, FR"]. The ISO country is the LAST token of the standardized
 * string; the city is the FIRST token of the tenant's own label (the
 * standardized one can stop at the region, "England"). Exported for tests.
 */
export function placeFromEightfold(position: EightfoldPosition): { location?: string; city?: string; country?: string } {
  const split = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
  const rawParts = position.locations?.[0] ? split(position.locations[0]) : [];
  const standardized = position.standardizedLocations?.[0];

  if (standardized && typeof standardized === 'object') {
    return {
      location: rawParts.join(', ') || standardized.city,
      city: rawParts[0] ?? standardized.city,
      country: standardized.country,
    };
  }

  const stdParts = typeof standardized === 'string' ? split(standardized) : [];
  const last = stdParts.at(-1);
  const country = last && /^[A-Z]{2}$/.test(last) ? last : rawParts.length > 1 ? rawParts.at(-1) : undefined;
  return {
    location: rawParts.join(', ') || stdParts.join(', ') || undefined,
    city: rawParts[0] ?? (stdParts.length >= 3 ? stdParts[0] : undefined),
    country,
  };
}


/**
 * Best-effort session cookie from the careers page. It is NOT required — the
 * /api/pcsx/search endpoint answers 200 without a cookie (verified). So a failure
 * here (a 405/throttle, common when several brands share one tenant like ELC's
 * careers.elcompanies.com hit 6×/run) must NOT sink the whole source: return an
 * empty cookie and let the search run. Before this, one throttled brand (origins)
 * failed the entire feed while its siblings succeeded.
 */
async function openSession(origin: string): Promise<string> {
  try {
    const response = await fetchWithRetry(`${origin}/careers`, {
      headers: { 'user-agent': USER_AGENT },
    });
    const cookies = response.headers.getSetCookie?.() ?? [];
    await response.body?.cancel();
    return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  } catch (error) {
    await log.warn('adapter.incomplete', `[eightfold] session cookie unavailable for ${origin} (${error instanceof Error ? error.message : error}); continuing without it`);
    return '';
  }
}

/**
 * Une page de liste ne se perd plus dans une fenêtre du pare-feu : un échec qui n'est pas une disparition (404,
 * 410) est relu UNE fois, `WAF_WINDOW_WAIT_MS` plus tard. Sans elle, une seule page refusée faisait échouer la
 * collecte entière (Kering, 28/09, start=700). Une source déjà arrêtée n'attend pas ; un second échec est levé.
 */
async function readAfterWafWindow<T>(read: () => Promise<T>, what: string): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (gone(error)) throw error;
    assertSourceRunning();
    await log.warn('adapter.incomplete', `[eightfold] ${what} en échec (${brief(error)}) ; relue une fois dans ${WAF_WINDOW_WAIT_MS / 1000} s`);
    await sourceDelay(WAF_WINDOW_WAIT_MS);
    return read();
  }
}

/**
 * LE MÊME CHEMIN D'IDENTITÉ que l'`externalId` publié par `toNormalized`, extrait pour être lisible AVANT la
 * validation du titre. `name` est volontairement exclu du repli : un intitulé n'est pas un identifiant
 * canonique, et une position sans `id` ni `displayJobId` ne peut nommer aucune absence historique.
 * `null` quand la ligne ne peut pas être nommée.
 */
function eightfoldCanonicalId(position: EightfoldPosition): string | null {
  const raw = position?.id ?? position?.displayJobId;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

/**
 * Exportée pour le REJEU (`publication/recovery.ts`), qui doit reconstruire une offre à partir du
 * seul `raw` conservé — ici la position Eightfold entière. Le rejeu emprunte ainsi exactement le
 * lecteur du collecteur, au lieu d'en réécrire un qui dériverait.
 */
export function toNormalized(position: EightfoldPosition, origin: string): NormalizedJob | null {
  if (!position.name) return null;

  const place = placeFromEightfold(position);
  const postedAt = position.postedTs ? new Date(position.postedTs * 1000) : undefined;

  // positionUrl is RELATIVE ("/careers/job/123"): stored as-is it is not a
  // fetchable URL, so every Eightfold apply link (Estée Lauder, Dr. Jart+…) was
  // a dead relative path. Resolve it against the origin; verified 200.
  /**
   * L'URL est construite depuis l'id de LA position, jamais reprise de
   * `positionUrl` : sur la liste `positions`, Eightfold y met l'URL canonique
   * du GROUPE de positions similaires — 125 offres Estée Lauder envoyaient le
   * candidat sur une autre position (autre ville, autre contrat), promesse D18
   * rompue (audit A1, 2026-09-06). Vérifié : `/careers/job/<id>` → 200.
   */
  const positionUrl = position.id
    ? `${origin}/careers/job/${position.id}`
    : position.positionUrl
      ? new URL(position.positionUrl, `${origin}/`).toString()
      : `${origin}/careers?pid=`;

  return {
    externalId: String(position.id ?? position.displayJobId ?? position.name),
    title: position.name,
    ...place,
    url: positionUrl,
    postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : undefined,
    raw: position,
  };
}

/**
 * Reads a whole Eightfold board.
 * `config.origin` e.g. "https://careers.elcompanies.com".
 * `config.domain` e.g. "elcompanies.com".
 */
export async function fetchEightfoldJobs(
  config: Record<string, unknown>,
): Promise<AdapterResult> {
  const origin = String(config.origin ?? '').replace(/\/$/, '');
  const domain = String(config.domain ?? origin.replace(/^https?:\/\/careers\./, ''));
  if (!origin) throw new Error('Eightfold origin missing');

  /*
   * LA LANGUE DEMANDÉE AU PORTAIL, plus jamais le français pour le monde entier.
   *
   * L'appel de détail forçait la locale française. Les deux portails servis
   * par cet adaptateur — `careers.elcompanies.com` (Estée Lauder) et
   * `careers.kering.com` (toutes les Maisons Kering) — publient dans le monde
   * entier : on réclamait donc la version française de descriptions
   * américaines, japonaises ou allemandes.
   *
   * Ce paramètre décide de la langue du texte qu'on INGÈRE, donc de ce que le
   * candidat lira. Il devient configurable par source, comme `config.locale`
   * de `digitalrecruiters.ts`. Le défaut est `en`, langue de publication la
   * plus courante de ces deux portails, plutôt qu'un français imposé.
   *
   * CE QUI N'EST PAS PROUVÉ ICI : ce que chaque portail RÉPOND face à une
   * locale qu'il ne sert pas. Cela se vérifie source par source, en ligne.
   */
  const hl = String(config.locale ?? 'en');

  const cookie = await openSession(origin);
  const headers = {
    'user-agent': USER_AGENT,
    accept: 'application/json',
    referer: `${origin}/careers`,
    ...(cookie ? { cookie } : {}),
  };

  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  // F-04: the vendor's own announced count — the truncation signal.
  let declaredTotal: number | undefined;
  /**
   * Enumeration proof (2026-09-09): Kering read 1 030 of 1 031 announced, run
   * after run, with no stated cause. Every page is archived (start, ids,
   * sha256, count); a position repeated across pages (unstable ranking) or
   * one the mapper rejects is counted and named, so a deficit is explained
   * rather than flagged.
   */
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  const issues = new Set<string>();
  /**
   * LE CONTRAT DES IDENTIFIANTS CANONIQUES.
   *
   * `String(position.id)` est l'identifiant NATIF du portail et alimente à la fois cette preuve et
   * `NormalizedJob.externalId` (`toNormalized`) : c'est le seul ensemble comparable à la base.
   *
   * L'IDENTIFIANT ENTRE DANS LA PREUVE AVANT LA VALIDATION — la leçon TalentRecruiter. Une position dotée
   * d'un `id` a été OBSERVÉE même si le mappeur la refuse (pas de `name`). La refuser d'abord la faisait
   * sortir sans figurer dans `canonicalIds` ; une JobSource historique portant ce même identifiant aurait
   * alors paru ABSENTE, donc fermée, alors que le portail la publie toujours. Le refus devient une
   * DISPOSITION nommée dans `rejectedRows`, jamais un trou dans la preuve.
   *
   * Une position SANS `id` exploitable ne peut être ni nommée ni disposée : elle est comptée et signalée
   * (`canonicalAbsenceProofUsable`), jamais inventée.
   */
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [];
  const observed = new Set<string>();
  let anonymousRows = 0;
  let pagesRead = 0, rawCount = 0, repeatedIds = 0, unmapped = 0, termination = 'PAGE_BUDGET_EXHAUSTED';
  /** Les pages de la première lecture où une position déjà servie est revenue : là que le tri a bougé. */
  const repeatPages: number[] = [];

  /**
   * Lit UNE page de liste. La première lecture (`pass` 1) compte tout ; une relecture de réconciliation n'ajoute que
   * les positions encore jamais observées — une position déjà vue y est attendue, ni comptée ni redéclarée.
   */
  const readPage = async (page: number, pass: number) => {
    const url = `${origin}/api/pcsx/search?domain=${encodeURIComponent(domain)}&query=&location=&start=${page * PAGE_SIZE}&num=${PAGE_SIZE}`;
    const response = await readAfterWafWindow(() => fetchJson<SearchResponse>(url, { headers }), `page de liste start=${page * PAGE_SIZE}`);

    const positions = response.data?.positions ?? [];
    pagesRead += 1; if (pass === 1) rawCount += positions.length;
    let fresh = 0, repeatedHere = 0;
    const pageIds: string[] = [];
    const pageCanonicalIds: string[] = [];

    for (const position of positions) {
      /**
       * Le MÊME chemin d'identité que `toNormalized`, lu avant la validation. Une position déjà déclarée sur
       * une page précédente n'est pas redéclarée : l'ensemble observé est un ensemble.
       */
      const canonicalId = eightfoldCanonicalId(position);
      if (pass > 1 && (!canonicalId || observed.has(canonicalId))) continue;
      if (canonicalId) { if (!observed.has(canonicalId)) { observed.add(canonicalId); pageCanonicalIds.push(canonicalId); } }
      else anonymousRows += 1;

      const job = toNormalized(position, origin);
      if (!job) {
        unmapped += 1;
        // Un identifiant exploitable fait du refus une DISPOSITION nommée, jamais un trou dans la preuve.
        rejectedRows.push({ reason: 'POSITION_WITHOUT_TITLE', raw: position, ...(canonicalId ? { canonicalId } : {}) });
        continue;
      }
      pageIds.push(job.externalId);
      if (seen.has(job.externalId)) { repeatedIds += 1; repeatedHere += 1; continue; }
      seen.add(job.externalId);
      jobs.push(job);
      fresh++;
    }
    if (repeatedHere) repeatPages.push(page);

    const count = response.data?.count;
    if (count !== undefined) {
      if (declaredTotal === undefined) declaredTotal = count;
      else if (declaredTotal !== count) issues.add('SOURCE_TOTAL_CHANGED');
    }
    pageEvidence.push({ url, checkedAt: captureObservedAt().toISOString(), sha256: createHash('sha256').update(JSON.stringify(response)).digest('hex'), offset: page * PAGE_SIZE, pagination: null,
      ids: pageIds, canonicalIds: pageCanonicalIds, publisherCounter: count === undefined ? '' : `count=${count}`,
      componentCounters: [`positions=${positions.length}`, `uniqueIds=${seen.size}`, `repeated=${repeatedIds}`, `unmapped=${unmapped}`, `canonicalIds=${observed.size}`, `anonymousRows=${anonymousRows}`,
        ...(pass > 1 ? [`pass=${pass}`, `fresh=${fresh}`] : [])] });
    return { positions: positions.length, count, fresh };
  };

  for (let page = 0; page < MAX_PAGES; page++) {
    const { positions, count, fresh } = await readPage(page, 1);
    if (positions === 0) { termination = 'EMPTY_PAGE'; break; }
    if (count !== undefined && seen.size >= count) { termination = 'PUBLISHER_TOTAL_REACHED'; break; }
    if (fresh === 0) { termination = 'REPEATED_PAGE'; break; }
    // A short page ends the board only when the publisher announces nothing more.
    if (positions < PAGE_SIZE && (count === undefined || rawCount >= count)) { termination = rawCount >= (count ?? 0) && count !== undefined ? 'PUBLISHER_TOTAL_ROWS_READ' : 'SHORT_PAGE'; break; }
  }

  /**
   * RELECTURE DE RÉCONCILIATION (D-522 §6, 03/10/2026), sur le modèle de Phenom et de Workday.
   *
   * Le tri par défaut du portail (`sortBy: "hot"`) n'est pas stable entre positions de même date : au RUN du 02/10, Kering
   * a servi 563705892206374 en fin de start=600 puis de nouveau en tête de start=610, à la place de 563705887980440, à total
   * inchangé (1 099) — 1 098 lues, liste réfutée. Aucun autre tri n'offre d'ordre garanti (`timestamp`, `relevance` : égalités
   * sans ordre, relu en ligne le 03/10). Quand une répétition laisse le total annoncé non atteint, on relit d'abord la page de
   * chaque répétition puis la précédente (là où l'égalité chevauche la coupure), puis, s'il manque encore des positions, la
   * liste entière, au plus `RECONCILIATION_SWEEPS` fois, en s'arrêtant dès que le total est atteint. La liste n'est prouvée que
   * si l'union atteint exactement le total annoncé et qu'il n'a pas changé. La répétition reste nommée.
   *
   * Le choix des pages relues ne dépend que des réponses : le rejeu hors réseau, qui sert les réponses d'une même adresse
   * dans l'ordre de leur capture, relit exactement les mêmes pages.
   */
  if (repeatedIds && declaredTotal !== undefined && seen.size < declaredTotal && termination !== 'PAGE_BUDGET_EXHAUSTED' && !issues.has('SOURCE_TOTAL_CHANGED')) {
    const total = declaredTotal;
    const lastPage = Math.ceil(total / PAGE_SIZE) - 1;
    const targeted = [...new Set(repeatPages.flatMap((page) => [page, page - 1]))].filter((page) => page >= 0 && page <= lastPage);
    const missing = () => seen.size < total && !issues.has('SOURCE_TOTAL_CHANGED');
    for (const page of targeted) { if (!missing()) break; await readPage(page, 2); }
    for (let sweep = 0; sweep < RECONCILIATION_SWEEPS && missing(); sweep++) {
      for (let page = 0; page <= lastPage && missing(); page++) {
        if ((await readPage(page, 3 + sweep)).positions === 0) break;
      }
    }
    if (seen.size === total && !issues.has('SOURCE_TOTAL_CHANGED')) { termination = 'SECOND_SWEEP_RECONCILED'; issues.add('RECONCILED_BY_SECOND_SWEEP'); }
  }
  if (repeatedIds) issues.add('REPEATED_IDS_ACROSS_PAGES');
  if (unmapped) issues.add('POSITIONS_WITHOUT_ID_OR_TITLE');
  if (anonymousRows) issues.add('ROW_WITHOUT_CANONICAL_ID');
  const complete = declaredTotal !== undefined && seen.size === declaredTotal && termination !== 'PAGE_BUDGET_EXHAUSTED' && !issues.has('SOURCE_TOTAL_CHANGED');
  if (!complete) issues.add('ENUMERATION_NOT_PROVEN');
  const truncated = termination === 'PAGE_BUDGET_EXHAUSTED' || (declaredTotal !== undefined && rawCount < declaredTotal);
  const enumeration: AdapterResult['enumeration'] = { method: 'PUBLISHER_COUNT_JSON_PAGINATION', endpoint: `${origin}/api/pcsx/search?domain=${domain}`, pages: pagesRead, rawCount, termination, issues: [...issues],
    // Une position vue sans `id` ni `displayJobId` interdit de déclarer un identifiant historique absent.
    canonicalAbsenceProofUsable: anonymousRows === 0,
    scopes: [{ scope: 'positions', declaredTotal: declaredTotal ?? -1, uniqueIds: seen.size, pages: pagesRead, complete }], pageEvidence };

  if (config.withDescriptions === false) return { jobs, declaredTotal, complete, truncated, enumeration, ...(rejectedRows.length ? { rejectedRows } : {}) };

  // Descriptions come from a per-position endpoint; the listing has none.
  const limit = pLimit(Number(config.detailConcurrency ?? 4));
  const readDetail = async (job: NormalizedJob): Promise<NormalizedJob> => {
    const detail = await fetchJson<DetailResponse>(
      `${origin}/api/pcsx/position_details?position_id=${encodeURIComponent(job.externalId)}&domain=${encodeURIComponent(domain)}&hl=${encodeURIComponent(hl)}`,
      { headers },
    );
    return withDetail(job, detail.data);
  };
  /** Index des fiches en échec, et l'heure du dernier : la relecture attend la fin de SA fenêtre, pas davantage. */
  const failed: number[] = [];
  let lastFailureAt = 0;
  // D-517 : en lecture incrémentale, la fiche n'est lue que pour une position jamais vue.
  const toRead = jobs.filter(job => !isKnownPosting(job.externalId));
  const firstPass = await Promise.all(
    toRead.map((job, index) =>
      limit(async () => {
        try {
          return await readDetail(job);
        } catch (error) {
          // A failed detail fetch must not lose the listing entry. A position gone (404, 410) is not re-read.
          if (!gone(error)) { failed.push(index); lastFailureAt = Date.now(); }
          return job;
        }
      }),
    ),
  );
  const reread = await rereadFailedDetails(toRead, failed, lastFailureAt, (job) => limit(() => readDetail(job)));
  const withDescriptions = firstPass.map((job, index) => reread.get(index) ?? job);
  return { jobs: withDescriptions, declaredTotal, complete, truncated, enumeration, ...(rejectedRows.length ? { rejectedRows } : {}) };
}

/** The detail applied to its listing entry: text, Maison, terms, and the native evidence itself. */
function withDetail(job: NormalizedJob, data: DetailResponse['data']): NormalizedJob {
  const terms = termsOf(data);
  return {
    ...job,
    description: htmlToPlainText(data?.jobDescription ?? data?.job_description),
    // Group tenants: the offer belongs to its Maison, not the feed label.
    company: brandOf(data) ?? job.company,
    // "Fulltime-Regular" carries both; the boundary splits contract from time.
    contract: terms ?? job.contract,
    workingTime: terms && readEmployment(terms) !== null ? terms : job.workingTime,
    /*
     * LA FICHE DE DÉTAIL ENTRE DANS LE RAW (19/09/2026).
     *
     * `raw` était figé sur la position de LISTE, qui ne porte aucune description : le
     * rejeu (`publication/recovery.ts`) reconstruisait donc une offre muette, refusée en
     * CONTENT_MISSING. Mesuré sur Kering : 1 035 offres capturées, conservées, et
     * republiables par aucun chemin — le détail était lu, utilisé, puis jeté.
     *
     * On conserve la réponse de détail TELLE QUELLE, sous une clé qui dit d'où elle vient.
     * Le rejeu en relit la description avec le même lecteur que le collecteur ; rien n'est
     * reconstitué de mémoire, et la preuve native reste la capture.
     */
    raw: { ...(job.raw as Record<string, unknown>), eightfoldDetail: data },
    // D-481 §3 : la fiche est LUE et l'éditeur n'y publie rien ; le rejeu pose la même retenue (`recovery.ts`).
    ...(nativeDescriptionEmpty(data) ? { publicationHold: NATIVE_DESCRIPTION_EMPTY } : {}),
  };
}

/**
 * Les fiches perdues au premier passage, relues une fois après la fenêtre du pare-feu (`WAF_WINDOW_WAIT_MS`).
 * L'attente court depuis le DERNIER échec : une collecte qui a continué plusieurs minutes après lui ne réattend pas.
 * Une fiche encore en échec reste une offre de liste, refusée à la qualification comme avant — jamais une retenue.
 */
async function rereadFailedDetails(jobs: NormalizedJob[], failed: number[], lastFailureAt: number,
  read: (job: NormalizedJob) => Promise<NormalizedJob>): Promise<Map<number, NormalizedJob>> {
  const recovered = new Map<number, NormalizedJob>();
  if (!failed.length) return recovered;
  const bound = Math.max(DETAIL_REREAD_FLOOR, Math.ceil(jobs.length * DETAIL_REREAD_SHARE));
  if (failed.length > bound) {
    await log.warn('adapter.incomplete', `[eightfold] ${failed.length} fiches en échec sur ${jobs.length}, au-delà de ${bound} : portail en panne, aucune relecture`);
    return recovered;
  }
  assertSourceRunning();
  const waitMs = Math.max(0, lastFailureAt + WAF_WINDOW_WAIT_MS - Date.now());
  await sourceDelay(waitMs);
  await Promise.all(failed.map(async (index) => {
    try { recovered.set(index, await read(jobs[index])); } catch { /* stays a listing entry, as before */ }
  }));
  await log.warn('adapter.incomplete', `[eightfold] ${failed.length} fiches en échec relues après ${Math.round(waitMs / 1000)} s : ${recovered.size} retrouvées`);
  return recovered;
}
