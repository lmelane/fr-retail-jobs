import { createHash } from 'node:crypto';
import { captureObservedAt } from '../../capture/context.js';
import { normalizeLanguage } from '../../normalize/language.js';
import { lvmhExperienceYears } from '../../normalize/experience.js';
import { fetchJson, fetchText } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { CRAWLER_IDENTITY } from '../../lib/crawlerIdentity.js';

/**
 * LVMH's public job index — Sephora, Louis Vuitton, Dior, Tiffany and 49 other
 * Maisons behind one Algolia query.
 *
 * Three earlier discovery passes concluded LVMH had no enumerable listing: the
 * offers/search routes 404, the page is client-rendered, and www.lvmh.com kills
 * headless Chromium with ERR_HTTP2_PROTOCOL_ERROR. All true, and all beside the
 * point — the index is reachable directly, and the credentials are static in
 * the site's own JS bundle.
 *
 * Verified 2026-09-02: nbHits 5222 with exhaustiveNbHits true, of which 1200 in
 * France. Every hit carries the full posting in four blocks plus a direct apply
 * URL on the employer's ATS.
 *
 * Two traps this file exists to avoid:
 *  - The 32-hex string in the page HTML is a PRISMIC IMAGE HASH, not a key.
 *    Using it returns 403. The real credentials live in the JS chunks.
 *  - The key is a public search key embedded client-side, so LVMH rotates it on
 *    deploy. A 403 must fail loudly: a silent empty result reads as "this Maison
 *    has no openings", which is how a dead WTTJ key produced false negatives
 *    across three discovery batches.
 */

const APP_ID = 'SDMQTD2J9T';
const INDEX = 'PRD-en-us';
const HOST = `https://${APP_ID}-dsn.algolia.net`;

/** Known-good as of 2026-09-02; refreshed from the bundle when it stops working. */
const FALLBACK_KEY = 'a5c6f4c87dea9aac0732631cd87583b2';

/** Algolia's own maximum. The index sets no paginationLimitedTo, verified to page 53. */
const PAGE_SIZE = 100;

/** Guard against a changed response shape paginating forever. */
const MAX_PAGES = Number(process.env.LVMH_MAX_PAGES ?? 120);

const LISTING_URL = 'https://www.lvmh.com/join-us/our-job-offers';

const USER_AGENT =
  CRAWLER_IDENTITY;

type LvmhHit = {
  objectID?: string | number;
  name?: string;
  maison?: string;
  businessGroup?: string;
  city?: string;
  country?: string;
  countryRegion?: string;
  contract?: string;
  fullTimePartTime?: string;
  function?: string;
  /** Apply URL on the Maison's own ATS. */
  link?: string;
  atsId?: string | number;
  /** The posting, split across four blocks the site renders in order. */
  description?: string;
  jobResponsabilities?: string;
  profile?: string;
  additionalInformation?: string;
  /** Epoch SECONDS of publication (probed live 2026-09-03) — F-05. */
  publicationTimestamp?: number;
  /** "EN", "FR", "ZH-HANS", "IT"… present on 5 490/5 490 hits (l2, 2026-09-06), never mapped before. */
  language?: string;
  /**
   * Le libellé D'AFFICHAGE de l'expérience, TRADUIT dans la langue de l'annonce
   * (« Minimum 3 ans », « Mindestens 3 Jahre », « 3年以上 »… 25 valeurs mesurées
   * en six langues). NON lu : voir `requiredExperienceFilter`.
   */
  requiredExperience?: string;
  /**
   * La forme CANONIQUE de l'expérience, indépendante de la langue — celle que
   * le site utilise pour sa propre facette. 4 valeurs, 5 443 offres.
   */
  requiredExperienceFilter?: string;
};

type AlgoliaResponse = {
  hits?: LvmhHit[];
  nbHits?: number;
  message?: string;
  status?: number;
};


/**
 * Re-reads the search key from the site's JS bundle.
 *
 * Called only when the pinned key is refused, so the usual path costs no extra
 * requests. The credentials appear as a literal `("SDMQTD2J9T","<key>")` pair.
 */
async function extractKeyFromBundle(): Promise<string | undefined> {
  const html = await fetchText(LISTING_URL, { headers: { 'user-agent': USER_AGENT } });
  const chunks = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map(
    (match) => match[1],
  );

  for (const chunk of chunks) {
    try {
      const source = await fetchText(`https://www.lvmh.com${chunk}`, {
        headers: { 'user-agent': USER_AGENT },
      });
      const key = source.match(new RegExp(`"${APP_ID}"\\s*,\\s*"([0-9a-f]{32})"`))?.[1];
      if (key) return key;
    } catch {
      // One unreachable chunk must not stop the search.
    }
  }
  return undefined;
}

async function query(key: string, filters: string, page: number): Promise<AlgoliaResponse> {
  return fetchJson<AlgoliaResponse>(`${HOST}/1/indexes/${INDEX}/query`, {
    method: 'POST',
    headers: {
      'x-algolia-application-id': APP_ID,
      'x-algolia-api-key': key,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: '', filters, hitsPerPage: PAGE_SIZE, page }),
  });
}

/**
 * L'identifiant CANONIQUE d'un hit — `objectID`, à défaut `atsId`, et RIEN D'AUTRE.
 *
 * `parseLvmhHit` retombe en dernier recours sur `hit.name`, c'est-à-dire sur le TITRE. Un titre n'est pas
 * une identité : deux « Conseiller de vente » partagent le même, et un titre réécrit par la Maison change
 * l'identifiant sans que l'offre ait bougé. Une telle ligne est donc ANONYME pour la preuve d'absence —
 * elle est observée et publiée normalement, mais elle interdit de déclarer un identifiant historique
 * disparu, puisqu'il pourrait être celle-là.
 */
export function lvmhCanonicalId(hit: LvmhHit): string | null {
  const id = hit.objectID ?? hit.atsId;
  return id === undefined || id === null || String(id).trim() === '' ? null : String(id);
}

export function parseLvmhHit(hit: LvmhHit): NormalizedJob | null {
  if (!hit.name) return null;

  // The site renders these four blocks in this order; a candidate reads them
  // as one posting.
  const description = [hit.description, hit.jobResponsabilities, hit.profile, hit.additionalInformation]
    .map((part) => htmlToPlainText(part))
    .filter(Boolean)
    .join('\n\n');

  return {
    externalId: String(hit.objectID ?? hit.atsId ?? hit.name),
    title: hit.name,
    location: [hit.city, hit.countryRegion].filter(Boolean).join(', ') || undefined,
    city: hit.city,
    region: hit.countryRegion,
    country: hit.country,
    contract: hit.contract,
    workingTime: hit.fullTimePartTime,
    language: normalizeLanguage(hit.language),
    department: hit.function,
    // Lu depuis la forme canonique, jamais depuis le libellé traduit.
    experienceYears: lvmhExperienceYears(hit.requiredExperienceFilter),
    // The Maison, not the group: "Sephora", not "LVMH".
    company: hit.maison,
    group: hit.businessGroup,
    description: description || undefined,
    // The native body of TP01660 consists solely of this test marker (repeated
    // across sections). A real QA/security role merely mentioning tests stays a job.
    ...(/^(?:Just a smoke test\.[\s-]*)+$/i.test(description.trim()) ? { publicationHold: 'NATIVE_TEST_PUBLICATION' } : {}),
    // Straight to the Maison's own ATS — the canonical apply URL, which is why
    // this source outranks any jobboard reposting it.
    url: hit.link ?? `${LISTING_URL}?ref=${hit.objectID ?? ''}`,
    // F-05: the feed DOES carry a date — epoch seconds, not ms.
    postedAt: hit.publicationTimestamp ? new Date(hit.publicationTimestamp * 1000) : undefined,
    raw: hit,
  };
}

/**
 * Reads LVMH job offers.
 *
 * `config.maison` narrows to one Maison (exact facet value, e.g. "Sephora");
 * `config.country` narrows by country, defaulting to France. Omit both for the
 * whole index.
 */
export async function fetchLvmhJobs(config: Record<string, unknown> = {}): Promise<AdapterResult> {
  const filters = [
    'category:job',
    config.maison ? `maison:"${String(config.maison).replace(/"/g, '')}"` : '',
    config.country === null ? '' : `country:"${String(config.country ?? 'France')}"`,
  ]
    .filter(Boolean)
    .join(' AND ');

  let key = String(config.apiKey ?? FALLBACK_KEY);
  const jobs: NormalizedJob[] = [];
  const seen = new Set<string>();
  const pageEvidence: NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']> = [];
  let declaredTotal: number | undefined;
  let rawCount = 0, anonymousRows = 0;
  let termination = 'PAGE_BUDGET_EXHAUSTED';

  for (let page = 0; page < MAX_PAGES; page++) {
    let response = await query(key, filters, page);

    // The pinned key has been rotated: re-read it from the bundle once, then
    // retry. Failing loudly matters more than failing gracefully here — an
    // empty result is indistinguishable from "this Maison is not hiring".
    if (response.status === 403 && page === 0) {
      const fresh = await extractKeyFromBundle();
      if (!fresh) {
        throw new Error(
          'LVMH Algolia key rejected and no replacement found in the site bundle. ' +
            'Re-extract it from https://www.lvmh.com/join-us/our-job-offers rather than ' +
            'treating this as zero offers.',
        );
      }
      key = fresh;
      response = await query(key, filters, page);
    }

    if (response.status === 403 || response.message) {
      throw new Error(`LVMH Algolia refused the query: ${response.message ?? 'status 403'}`);
    }

    const hits = response.hits ?? [];
    rawCount += hits.length;
    /**
     * LE CONTRAT DES IDENTIFIANTS CANONIQUES.
     *
     * L'identifiant entre dans la preuve AVANT toute validation : un hit doté d'un `objectID` a été
     * OBSERVÉ même si `parseLvmhHit` le refuse ensuite faute de `name`, et l'omettre ferait paraître
     * ABSENTE au refresh suivant une JobSource historique portant ce même identifiant.
     *
     * Ce que la preuve archive est exactement ce que l'adaptateur ÉCRIT en `externalId` — y compris le
     * repli sur le titre, sans quoi l'offre publiée manquerait à sa propre preuve. Mais un identifiant
     * issu du titre n'est pas une identité : il rend l'attestation d'absence inexploitable pour ce cycle.
     */
    const ids: string[] = [];
    for (const hit of hits) {
      const canonical = lvmhCanonicalId(hit);
      const written = parseLvmhHit(hit)?.externalId;
      if (!canonical) anonymousRows++;
      const id = canonical ?? written;
      if (id) ids.push(id);
    }
    pageEvidence.push({ url: `${HOST}/1/indexes/${INDEX}/query`, checkedAt: captureObservedAt().toISOString(),
      sha256: createHash('sha256').update(JSON.stringify(response)).digest('hex'), offset: page * PAGE_SIZE,
      pagination: response.nbHits === undefined ? null
        : { start: page * PAGE_SIZE + 1, end: page * PAGE_SIZE + hits.length, total: response.nbHits },
      ids, canonicalIds: ids, publisherCounter: response.nbHits === undefined ? '' : String(response.nbHits),
      componentCounters: [`filters=${filters}`, `hitsPerPage=${PAGE_SIZE}`, `page=${page}`] });

    let fresh = 0;
    for (const hit of hits) {
      const job = parseLvmhHit(hit);
      if (!job || seen.has(job.externalId)) continue;
      seen.add(job.externalId);
      jobs.push(job);
      fresh++;
    }

    if (response.nbHits !== undefined) declaredTotal = response.nbHits;
    if (hits.length < PAGE_SIZE || fresh === 0) { termination = hits.length < PAGE_SIZE ? 'SHORT_PAGE' : 'NO_FRESH_HITS'; break; }
    if (response.nbHits !== undefined && jobs.length >= response.nbHits) { termination = 'DECLARED_TOTAL_REACHED'; break; }
  }

  /**
   * Un hit VU dont l'identifiant est connu mais qui n'a pas été publié (pas de `name`, ou identifiant
   * déjà rencontré) est nommé ici comme DISPOSITION : sans cela il resterait un trou dans la preuve.
   */
  const published = new Set(jobs.map((job) => job.externalId));
  const rejectedRows: NonNullable<AdapterResult['rejectedRows']> = [
    ...new Set(pageEvidence.flatMap((pe) => pe.canonicalIds ?? [])),
  ].filter((id) => !published.has(id)).map((id) => ({ reason: 'MISSING_NAME_OR_REPEATED_ID', raw: { objectID: id }, canonicalId: id }));

  return { jobs, declaredTotal, rejectedRows,
    enumeration: { method: 'PUBLIC_ALGOLIA_INDEX_PAGINATION', endpoint: `${HOST}/1/indexes/${INDEX}/query`,
      pages: pageEvidence.length, rawCount, termination,
      // Un hit sans `objectID` ni `atsId` n'est identifié que par son titre : ce n'est pas une identité,
      // donc aucun identifiant historique ne peut être déclaré absent pour ce cycle.
      canonicalAbsenceProofUsable: anonymousRows === 0, pageEvidence } };
}
