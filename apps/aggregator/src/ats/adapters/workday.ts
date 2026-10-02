import { workdayDetailMatchesListing } from '../../identity/workday.js';
import { captureObservedAt } from '../../capture/context.js';
import { createHash } from 'node:crypto';
import pLimit from 'p-limit';
import { fetchJson } from '../../lib/http.js';
import { htmlToPlainText } from '../../lib/html.js';
import type { AdapterResult, NormalizedJob } from '../../types.js';
import { workdayPortal } from '../portalConfig.js';
import { isKnownPosting } from '../../lib/incrementalReading.js';
import { assertSourceRunning } from '../../lib/sourceBudget.js';

// externalPath is optional in practice: some tenants (Richemont) return rows
// without it, and treating it as always-present crashed the whole source.
type WorkdayPosting = { title: string; externalPath?: string; locationsText?: string; postedOn?: string; bulletFields?: string[] };

/**
 * Locale demandé à Workday, liste ET détail. Le transport commun envoie fr-FR
 * par défaut ; Workday traduit alors tout par machine : 1 794 offres Tapestry en
 * français, « Entraîneur Netherlands B.V. » pour Coach, pays « États-Unis
 * d'Amérique » (98 lignes non ISO), 161 Levi's / 108 Richemont en `fr` hors pays
 * francophones (audit a4, 2026-09-06). En en-US, le tenant rend ses propres
 * textes et des libellés que la frontière sait normaliser.
 */
const EN_US = { 'accept-language': 'en-US,en;q=0.9' } as const;

/** Matches a requisition id (R_778886, JR12345, REQ-90210) — never a place. */
const REQUISITION_ID = /^(r|jr|req)[_-]?\d+$/i;

/**
 * The location a tenant put in `bulletFields` instead of `locationsText`.
 *
 * Workday's own UI shows the bullets as "location · location · requisition id".
 * Taking the first non-id bullet therefore reads the location exactly where the
 * candidate sees it. Returns undefined rather than a wrong guess when the only
 * bullets are ids — a missing location is honest, a requisition id shown as a
 * city is not.
 */
export function locationFromBullets(bullets?: string[]): string | undefined {
  return bullets?.map((b) => b.trim()).find((b) => b.length > 1 && !REQUISITION_ID.test(b));
}

type WorkdayFacetValue = { descriptor?: string; id?: string; count?: number };
type WorkdayFacet = { facetParameter?: string; descriptor?: string; values?: WorkdayFacetValue[] };
type WorkdayPage = { total?: number; jobPostings?: WorkdayPosting[]; facets?: WorkdayFacet[] };

type Scope = NonNullable<NonNullable<AdapterResult['enumeration']>['scopes']>[number];
type PageEvidence = NonNullable<NonNullable<AdapterResult['enumeration']>['pageEvidence']>[number];

/** One board to enumerate: the whole site, or one value of the partition facet. */
type Board = {
  appliedFacets: Record<string, string[]>;
  scope: string;
  /** Set when the board is one value of a partition facet: every posting read on it carries that value as its employer. */
  partition?: { parameter: string; value: string; id: string };
  /** The whole site, read AFTER the partitions: postings that carry no value of the facet (Tapestry: 6 of 2 091). */
  remainder?: boolean;
  /**
   * One value of the COVERING facet chosen when the site total is capped (`coveringFacet`): it only enumerates, it never
   * attributes an employer (a job family or a state is not a Maison).
   */
  cover?: { parameter: string; value: string; id: string };
};

/** State shared by every board of one source: postings, ids, evidence, rejects. */
/**
 * Tenant store coding in `locationsText` (Saks, 2026-09-10: "NM_0114_Houston", "SF_0669_NAPLES FL",
 * "BG_9066_BG CORPORATE", "O5_0842_BUCKHEAD" — 701 of 747 postings): the prefix is the banner, the
 * tenant's own attribution of the posting. Opt-in per Source: `brandFromLocationPrefix: { map: { NM:
 * "Neiman Marcus", … }, otherwise?: "Group name" }`. A posting without a mapped prefix takes `otherwise`
 * when set (the group, for corporate/remote rows) and stays unattributed here otherwise.
 */
type LocationPrefixRule = { map: Record<string, string>; otherwise?: string };
export const LOCATION_PREFIX_RULE = 'LOCATION_CODE_PREFIX';
export const LOCATION_PREFIX_OTHERWISE_RULE = 'LOCATION_CODE_PREFIX_ABSENT';
export function locationPrefixRule(config: Record<string, unknown>): LocationPrefixRule | undefined {
  const raw = config.brandFromLocationPrefix as { map?: unknown; otherwise?: unknown } | undefined;
  if (!raw || typeof raw !== 'object' || !raw.map || typeof raw.map !== 'object') return undefined;
  const map = Object.fromEntries(Object.entries(raw.map as Record<string, unknown>).filter(([k, v]) => /^[A-Z0-9]{1,6}$/.test(k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v).trim()]));
  if (!Object.keys(map).length) return undefined;
  return { map, ...(typeof raw.otherwise === 'string' && raw.otherwise.trim() ? { otherwise: raw.otherwise.trim() } : {}) };
}
export function brandFromLocationPrefix(locationsText: string | undefined, rule: LocationPrefixRule): { brand: string; prefix: string | null } | undefined {
  const m = /^([A-Z0-9]{1,6})_/.exec(locationsText?.trim() ?? '');
  const prefix = m?.[1];
  if (prefix && rule.map[prefix]) return { brand: rule.map[prefix]!, prefix };
  return rule.otherwise ? { brand: rule.otherwise, prefix: null } : undefined;
}

type Shared = {
  endpoint: string; origin: string; site: string;
  prefixRule?: LocationPrefixRule;
  out: NormalizedJob[]; seen: Set<string>; pageEvidence: PageEvidence[]; issues: Set<string>;
  rejectedRows: NonNullable<AdapterResult['rejectedRows']>; pathlessRows: Set<string>;
  /** The facets of the site's first page (unfiltered board, offset 0, first pass): what a capped site still counts. */
  siteFacets?: WorkdayFacet[];
  /** Ids read on the boards of the covering facet, across boards: an id met twice is an overlap of the covering facet. */
  coverIds: Set<string>;
};

type BoardResult = {
  scope: string; total: number; uniqueIds: number; pages: number; rawCount: number; repeatedIds: number; withoutPath: number;
  /** Ids of this board already read on an EARLIER board: a posting cannot belong to two partition values. */
  overlap: number;
  /** Postings this board added to the source (on the remainder board: postings outside every partition). */
  fresh: number; termination: string; complete: boolean;
  /** The cap probe found postings past an announced total at the cap (`WORKDAY_TOTAL_CAP`). */
  capped?: boolean;
};

const PARTITION_RULE = 'PARTITION_FACET_VALUE';
/** Le `total` que Workday annonce ne dépasse jamais cette valeur, même quand le site tient davantage (knitwell, 3 463). */
export const WORKDAY_TOTAL_CAP = 2000;

async function readPage(shared: Shared, board: Board, offset: number): Promise<WorkdayPage> {
  return fetchJson<WorkdayPage>(shared.endpoint, {
    method: 'POST',
    /**
     * `accept-language` fixé à en-US : le transport commun envoie fr-FR par
     * défaut, et un tenant dont le site carrière n'est pas traduit en
     * français répond 500 à cette seule en-tête — mesuré le 2026-09-05 sur
     * nordstrom.wd501 (200 en en-US, 500 en fr-FR, body identique). en-US est
     * le locale que tout site Workday sert ; la langue des offres, elle,
     * vient du tenant, pas de l'en-tête.
     */
    headers: { 'content-type': 'application/json', ...EN_US },
    body: JSON.stringify({ appliedFacets: board.appliedFacets, limit: 20, offset, searchText: '' }),
  });
}

function toJob(shared: Pick<Shared, 'origin' | 'site' | 'prefixRule'>, board: Pick<Board, 'partition'>, job: WorkdayPosting, externalId: string, observedAt = captureObservedAt()): NormalizedJob {
  const base: NormalizedJob = {
    externalId,
    title: job.title,
    /**
     * Not every tenant fills `locationsText`. Capri (Versace, Michael Kors,
     * Jimmy Choo) leaves it empty and puts the site in `bulletFields[0]`
     * instead — measured 2026-09-04: 621 offers, ALL with a location on the
     * page, ALL location-less once parsed. An offer with no location is
     * unusable for a candidate, so fall back to the first bullet field,
     * which is where Workday's own UI reads the location from. The last
     * bullet is the requisition id (R_778886), never a place: it is
     * excluded so an id is never displayed as a city.
     */
    location: job.locationsText || locationFromBullets(job.bulletFields),
    postedAt: postedAtFromWorkday(job.postedOn, observedAt),
    // The public career URL is {origin}/{site}{externalPath}, joined by
    // string — NOT new URL(externalPath, `${origin}/${site}/`), which
    // silently DROPS the /{site}/ segment because externalPath is an
    // absolute path ("/job/…") that overrides the base path. That produced
    // `${origin}/job/…` on every Richemont/Cartier offer → a 404 on every
    // apply link. Verified: `${origin}/${site}${externalPath}` → 200.
    url: `${shared.origin.replace(/\/$/, '')}/${shared.site}${job.externalPath}`,
    raw: job,
  };
  if (!board.partition) {
    if (!shared.prefixRule) return base;
    const attributed = brandFromLocationPrefix(job.locationsText, shared.prefixRule);
    if (!attributed) return base;
    // The tenant's store code names the banner; the code stays in the raw row for replay.
    return {
      ...base,
      company: attributed.brand,
      employerEvidence: attributed.prefix
        ? { rawName: attributed.brand, path: 'listing.locationsText.prefix', rule: LOCATION_PREFIX_RULE }
        : { rawName: attributed.brand, path: 'listing.locationsText.prefix', rule: LOCATION_PREFIX_OTHERWISE_RULE },
      raw: { ...job, locationPrefix: attributed.prefix },
    };
  }
  // The partition value is the tenant's own attribution of the posting (Tapestry
  // 2026-09-10: facet "Brand" = Coach 1 514 · Kate Spade 502 · Tapestry 69, while the
  // legal entity of 1 570 of them reads "Tapestry, Inc."). It is the employer; the
  // legal entity and the logo stay in the detail for replay.
  return {
    ...base,
    company: board.partition.value,
    employerEvidence: { rawName: board.partition.value, path: `listing.facets.${board.partition.parameter}`, rule: PARTITION_RULE },
    raw: { ...job, facet: board.partition },
  };
}

/** What one board keeps across its passes: the ids it read, and the path-less witnesses already recorded per content. */
type BoardMemory = { ids: Set<string>; pathlessWitnesses: Map<string, number> };
type PassResult = BoardResult & { totalChanged: boolean };
/** One path-less row as served: its content (hash) and its rank in the board, `offset + index`. */
type PathlessOccurrence = { hash: string; offset: number; index: number };
const pathlessHash = (job: WorkdayPosting) => createHash('sha256').update(JSON.stringify(job)).digest('hex');
const workdayId = (externalPath: string) => externalPath.split('/').filter(Boolean).pop() ?? externalPath;

/**
 * Enumerate one board page by page, with the second sweep when an unstable sort
 * repeated ids. Postings go to the shared list unless an earlier board already
 * read them (overlap, counted and named, never pushed twice).
 *
 * UNE SECONDE PASSE ENTIÈRE QUAND LE TOTAL CHANGE PENDANT LA LECTURE (D-482, 30/09/2026, Nordstrom du 29/09).
 * La page 0 annonçait 1 329 offres ; les 67 pages en ont servi 1 328, toutes distinctes, sans ligne sans chemin ; la
 * page lue au-delà de la fin (offset 1 340) ressert la tête du tableau avec un total de 1 328 : une offre a été
 * retirée pendant la lecture. Aucun compte de cette passe ne prouve le tableau — si l'offre retirée était déjà lue,
 * le décalage a fait sauter une offre vivante à une frontière de page, et 1 328 identifiants distincts en cachent
 * une morte et en perdent une. Le tableau est donc relu en entier, une fois : la preuve se juge sur cette seconde
 * passe seule, sous son propre total. Les offres de la première restent collectées (union) : une offre retirée
 * entre-temps reste un jour de plus, aucune offre en ligne n'est fermée à tort. Un second changement reste non
 * prouvé. Le rejeu hors réseau sert les pages d'un même offset dans l'ordre de leur capture : il relit la même passe.
 */
async function enumerateBoard(shared: Shared, board: Board): Promise<BoardResult> {
  const memory: BoardMemory = { ids: new Set(), pathlessWitnesses: new Map() };
  const first = await readPass(shared, board, memory, 1);
  if (!first.totalChanged || first.termination === 'PAGE_BUDGET_EXHAUSTED') return first;
  const second = await readPass(shared, board, memory, 2);
  if (second.complete) shared.issues.add('RECONCILED_BY_FRESH_PASS');
  return { ...second, pages: first.pages + second.pages, rawCount: first.rawCount + second.rawCount,
    overlap: first.overlap + second.overlap, fresh: first.fresh + second.fresh };
}

async function readPass(shared: Shared, board: Board, memory: BoardMemory, pass: number): Promise<PassResult> {
  /**
   * Workday reports `total` ONLY on the first page — every later page returns
   * total: 0. Comparing against it each time stops the loop at 40 of 1088, so
   * the count is captured once and the loop otherwise ends on a short page.
   *
   * Enumeration proof (2026-09-09): each page is archived (offset, ids, sha256,
   * the publisher total when the page carries one). Nordstrom and Swatch read
   * one posting fewer than the announced total run after run; the proof now
   * says WHY — a posting repeated across pages (unstable sort), a row without
   * `externalPath`, or a total that the board simply never serves — instead of
   * an unexplained −1.
   */
  let total = 0, totalChanged = false;
  const local = new Set<string>();
  const occurrences: PathlessOccurrence[] = [];
  /** Contents whose occurrences kept their ranks on a re-read: distinct announced rows, counted by rank. */
  const distinctByRank = new Set<string>();
  const pathlessCount = () => {
    const ranks = new Map<string, Set<number>>();
    for (const o of occurrences) ranks.set(o.hash, (ranks.get(o.hash) ?? new Set()).add(o.offset + o.index));
    return [...ranks].reduce((sum, [hash, at]) => sum + (distinctByRank.has(hash) ? at.size : 1), 0);
  };
  let pages = 0, rawCount = 0, repeatedIds = 0, overlap = 0, fresh = 0, termination = 'PAGE_BUDGET_EXHAUSTED';
  const facetOfBoard = board.partition ?? board.cover;
  const suffix = `${facetOfBoard ? `&${facetOfBoard.parameter}=${encodeURIComponent(facetOfBoard.id)}` : ''}${pass > 1 ? `&pass=${pass}` : ''}`;
  const take = (job: WorkdayPosting, externalId: string): boolean => {
    if (local.has(externalId)) return false;
    local.add(externalId);
    // Read by an earlier pass of this board: already collected, neither an overlap nor a new posting.
    if (memory.ids.has(externalId)) return true;
    memory.ids.add(externalId);
    // A covering board re-reads what the capped site served: expected. Its overlap is judged among covering boards only.
    if (board.cover) {
      if (shared.coverIds.has(externalId)) overlap += 1; else shared.coverIds.add(externalId);
      if (shared.seen.has(externalId)) return true;
    } else if (shared.seen.has(externalId)) { if (!board.remainder) overlap += 1; return true; }
    shared.seen.add(externalId); fresh += 1;
    shared.out.push(toJob(shared, board, job, externalId));
    return true;
  };

  let nextOffset = 0;
  for (let offset = 0; offset < 5000; offset += 20) {
    const page = await readPage(shared, board, offset);
    const postings = page.jobPostings ?? [];
    pages += 1; rawCount += postings.length; nextOffset = offset + 20;
    if (offset === 0 && pass === 1 && !Object.keys(board.appliedFacets).length && !shared.siteFacets && page.facets) shared.siteFacets = page.facets;
    if (page.total) {
      if (!total) total = page.total;
      else if (page.total !== total) { totalChanged = true; shared.issues.add('SOURCE_TOTAL_CHANGED'); }
    }
    const pageIds: string[] = [];
    for (const [index, job] of postings.entries()) {
      // A posting without an externalPath has neither a stable id nor a URL to
      // send a candidate to — skip it rather than crash the whole source on
      // `undefined.split`. Richemont's tenant returned such rows, and the throw
      // lost all ~1300 of its offers ("cartier-3 failed: reading 'split'").
      if (!job.externalPath) {
        // A path-less row has no id. Two occurrences of the same content are ONE row until a re-read proves that each
        // keeps its rank (below): distinct rows then, counted by rank. Every occurrence is a witness in the rejects,
        // recorded once per board even when a second pass serves it again.
        const hash = pathlessHash(job);
        occurrences.push({ hash, offset, index });
        const inPass = occurrences.filter((o) => o.hash === hash).length;
        if (inPass > (memory.pathlessWitnesses.get(hash) ?? 0)) {
          // Aucun identifiant canonique n'est FABRIQUÉ à partir du titre ou d'un hachage : ce serait
          // inventer une preuve. La ligne est archivée telle quelle, et le cycle perd le droit d'attester
          // une absence — un identifiant historique disparu pourrait être précisément celle-ci.
          shared.rejectedRows.push({ reason: 'ROW_WITHOUT_EXTERNAL_PATH', raw: job });
          memory.pathlessWitnesses.set(hash, inPass);
        }
        shared.pathlessRows.add(hash);
        continue;
      }
      const externalId = workdayId(job.externalPath);
      pageIds.push(externalId);
      if (!take(job, externalId)) repeatedIds += 1;
    }
    shared.pageEvidence.push({ url: `${shared.endpoint}#offset=${offset}${suffix}`, checkedAt: captureObservedAt().toISOString(), sha256: createHash('sha256').update(JSON.stringify(page)).digest('hex'), offset, pagination: null,
      /**
       * `ids` EST déjà l'identifiant canonique chez Workday : `externalPath.split('/').pop()` alimente à la
       * fois `take()` — donc `NormalizedJob.externalId` — et cette preuve. On le DÉCLARE explicitement plutôt
       * que de laisser un lecteur le supposer : sans la propriété, la source ne peut prouver aucune absence.
       *
       * Une ligne SANS `externalPath` n'a pas d'identifiant : elle est rejetée avec son motif, et ne peut donc
       * pas figurer ici. Son absence est comptée dans `withoutPath`, jamais confondue avec une disparition.
       */
      ids: pageIds, canonicalIds: pageIds,
      publisherCounter: page.total ? `total=${page.total}` : '', componentCounters: [`rows=${postings.length}`, `uniqueIds=${local.size}`, `repeated=${repeatedIds}`, `withoutPath=${pathlessCount()}`, ...(board.partition ? [`partition=${board.scope}`] : []), ...(board.cover ? [`cover=${board.scope}`] : []), ...(pass > 1 ? [`pass=${pass}`] : [])] });
    if (postings.length === 0) { termination = 'EMPTY_PAGE'; break; }
    // The announced total counts ROWS (a path-less row included): once that many
    // rows are read the board is exhausted, whether or not every row was a
    // usable posting. Completeness below is judged on unique usable ids.
    if (total && rawCount >= total) { termination = local.size >= total ? 'PUBLISHER_TOTAL_REACHED' : 'PUBLISHER_TOTAL_ROWS_READ'; break; }
    // A short page ends the board unless the publisher still announces more:
    // then the next offset is read, so a shortened page in the middle of the
    // board does not pass for its end.
    if (postings.length < 20 && !total) { termination = 'SHORT_PAGE'; break; }
  }
  /**
   * LIGNES SANS CHEMIN AU CONTENU IDENTIQUE (D-482, 30/09/2026, Mango). `{"bulletFields":["Fix-Term"]}` servie deux
   * fois : aux rangs 328 et 557 le 26/09, 307 et 326 le 29/09, en milieu de page, entre des voisins différents. Les
   * deux lectures indépendantes du 26/09, à six minutes, servent le tableau dans le MÊME ordre, rang pour rang
   * (0 différence sur 1 653), et ces deux lignes aux mêmes rangs : ce sont deux lignes annoncées, pas une ligne servie
   * deux fois. Chaque jour, identifiants + occurrences = total exactement (1 651 + 2 = 1 653 ; 1 662 + 2 = 1 664), et
   * les compter pour une seule réfutait le tableau (1 663 sur 1 664).
   *
   * Un tri instable peut pourtant servir UNE ligne deux fois, et faire sauter une offre à la frontière : les compter
   * par occurrence sans preuve cacherait cette offre. Les pages où tombe un contenu répété sont donc relues une fois ;
   * s'il se retrouve à CHACUN de ses rangs, ce sont des lignes distinctes, comptées par rang. Sinon il reste compté
   * une fois, et le tableau n'est pas prouvé (`PATHLESS_ROW_RANK_UNSTABLE`) — c'est la lecture prudente d'avant.
   * Seulement sur une passe sans identifiant répété : un tri qui a déjà répété une offre est instable, et la lecture
   * prudente (contenu compté une fois, grille décalée plus bas) reste la règle — Mango du 10/09.
   */
  const byHash = new Map<string, PathlessOccurrence[]>();
  for (const o of occurrences) byHash.set(o.hash, [...(byHash.get(o.hash) ?? []), o]);
  const repeatedContent = [...byHash].filter(([, list]) => list.length > 1);
  if (repeatedContent.length && repeatedIds === 0 && !totalChanged && termination !== 'PAGE_BUDGET_EXHAUSTED') {
    const reread = new Map<number, WorkdayPosting[]>();
    for (const offset of [...new Set(repeatedContent.flatMap(([, list]) => list.map((o) => o.offset)))].sort((a, b) => a - b)) {
      const page = await readPage(shared, board, offset);
      const postings = page.jobPostings ?? [];
      pages += 1;
      if (page.total && total && page.total !== total) { totalChanged = true; shared.issues.add('SOURCE_TOTAL_CHANGED'); }
      const pageIds: string[] = [];
      for (const job of postings) {
        if (!job.externalPath) continue;
        const externalId = workdayId(job.externalPath);
        pageIds.push(externalId);
        take(job, externalId);
      }
      reread.set(offset, postings);
      shared.pageEvidence.push({ url: `${shared.endpoint}#offset=${offset}&pathlessRecheck=1${suffix}`, checkedAt: captureObservedAt().toISOString(), sha256: createHash('sha256').update(JSON.stringify(page)).digest('hex'), offset, pagination: null,
        ids: pageIds, canonicalIds: pageIds, publisherCounter: page.total ? `total=${page.total}` : '', componentCounters: ['pathlessRecheck=1', `rows=${postings.length}`] });
    }
    for (const [hash, list] of repeatedContent) {
      const kept = list.every((o) => { const row = reread.get(o.offset)?.[o.index]; return row !== undefined && !row.externalPath && pathlessHash(row) === hash; });
      if (kept && !totalChanged) distinctByRank.add(hash); else shared.issues.add('PATHLESS_ROW_RANK_UNSTABLE');
    }
    if (distinctByRank.size) shared.issues.add('PATHLESS_ROWS_DISTINCT_BY_RANK');
  }
  /**
   * Plafond de l'éditeur (29/09/2026). Workday plafonne `total` à 2 000 : knitwell-us-retail en tient 3 463 (somme de
   * ses facettes), la lecture s'arrêtait à 2 000 lignes et se déclarait prouvée, et 209 offres encore en ligne ont été
   * fermées le 27/09. Quand la lecture s'arrête sur un total qui atteint le plafond, la page suivante est lue : un
   * identifiant jamais vu prouve que le total est un plafond, et le tableau n'est PAS prouvé (aucune fermeture). Une
   * page qui ne ressert que des identifiants connus est le retour en tête du tableau (Nordstrom), pas un plafond.
   */
  let capped = false;
  if (total >= WORKDAY_TOTAL_CAP && (termination === 'PUBLISHER_TOTAL_REACHED' || termination === 'PUBLISHER_TOTAL_ROWS_READ')) {
    const page = await readPage(shared, board, nextOffset);
    const postings = page.jobPostings ?? [];
    pages += 1;
    const pageIds: string[] = [];
    let unseen = 0;
    for (const job of postings) {
      if (!job.externalPath) continue;
      const externalId = workdayId(job.externalPath);
      pageIds.push(externalId);
      if (!local.has(externalId)) unseen += 1;
      take(job, externalId);
    }
    shared.pageEvidence.push({ url: `${shared.endpoint}#offset=${nextOffset}&capProbe=1${suffix}`, checkedAt: captureObservedAt().toISOString(), sha256: createHash('sha256').update(JSON.stringify(page)).digest('hex'), offset: nextOffset, pagination: null,
      ids: pageIds, canonicalIds: pageIds, publisherCounter: '', componentCounters: ['capProbe=1', `rows=${postings.length}`, `unseen=${unseen}`] });
    if (unseen) { capped = true; shared.issues.add('PUBLISHER_TOTAL_CAPPED'); }
  }
  /**
   * LE PLAFOND DIT PAR LES FACETTES (D-520, 02/10/2026). La sonde ci-dessus ne voit le plafond que si la page servie
   * au-delà porte un identifiant nouveau ; Workday y ressert une page déjà lue quand il veut. Collecte locale de
   * knitwell-us-retail le 02/10 à 15:13 UTC avec le code d'avant : 1 999 offres + 1 ligne sans chemin = 2 000, sonde
   * sans identifiant nouveau, liste « prouvée » — alors que ses facettes comptent 3 515 offres. En production, le RUN
   * du 30/09 l'a enregistrée ainsi (`complete`, `canAttestAbsence`) : une fausse preuve d'absence pour 1 515 offres en
   * ligne, la forme exacte du 27/09. Une facette à plat qui compte plus d'offres que le total annoncé au plafond est un
   * plafond, déterministe : le tableau n'est pas prouvé. Une facette à plusieurs valeurs par offre peut compter plus
   * sans plafond : elle rend la lecture non prouvée, jamais prouvée à tort.
   */
  // The remainder of a configured partition is the capped site by design: the partition judges it (`UNPARTITIONED_UNDER_CAP`).
  if (!capped && !board.remainder && !Object.keys(board.appliedFacets).length && total >= WORKDAY_TOTAL_CAP) {
    const counted = Math.max(0, ...flatFacets(shared.siteFacets).map((facet) => facet.sum));
    if (counted > total) { capped = true; shared.issues.add('PUBLISHER_TOTAL_CAPPED'); shared.issues.add(`FACETS_COUNT_BEYOND_TOTAL=${counted}`); }
  }
  /**
   * Second sweep (2026-09-10). An unstable sort can serve the same posting on two
   * consecutive pages while another posting slides between two page boundaries and
   * is never served (Levi's: 1 314 rows announced and read, 7 repeated, 1 306 unique).
   * When every announced row was read but repeated ids left announced postings
   * unseen, the board is re-read on a grid shifted by half a page: a posting that
   * fell between two boundaries of the first grid sits inside a page of the second.
   * The board is proven only when every announced row is then accounted for — as a
   * unique posting or as a rejected path-less row; the repetition stays named.
   */
  if (total > 0 && repeatedIds > 0 && local.size + pathlessCount() < total && termination !== 'PAGE_BUDGET_EXHAUSTED' && !totalChanged) {
    for (let offset = 10, sweepPages = 0; offset < total && local.size + pathlessCount() < total && sweepPages < 250; offset += 20, sweepPages += 1) {
      const page = await readPage(shared, board, offset);
      const postings = page.jobPostings ?? [];
      pages += 1;
      const pageIds: string[] = [];
      let freshInSweep = 0;
      for (const job of postings) {
        // Path-less rows were already counted (and rejected) by the first sweep; they carry no id to reconcile.
        if (!job.externalPath) continue;
        const externalId = workdayId(job.externalPath);
        pageIds.push(externalId);
        if (take(job, externalId)) freshInSweep += 1;
      }
      shared.pageEvidence.push({ url: `${shared.endpoint}#offset=${offset}&sweep=2${suffix}`, checkedAt: captureObservedAt().toISOString(), sha256: createHash('sha256').update(JSON.stringify(page)).digest('hex'), offset, pagination: null,
        ids: pageIds, canonicalIds: pageIds, publisherCounter: '', componentCounters: [`sweep=2`, `rows=${postings.length}`, `uniqueIds=${local.size}`, `freshInSweep=${freshInSweep}`] });
      if (postings.length === 0) break;
    }
    if (local.size + pathlessCount() >= total) { termination = 'SECOND_SWEEP_RECONCILED'; shared.issues.add('RECONCILED_BY_SECOND_SWEEP'); }
  }
  if (repeatedIds) shared.issues.add('REPEATED_IDS_ACROSS_PAGES');
  if (occurrences.length) shared.issues.add('ROWS_WITHOUT_EXTERNAL_PATH');
  const withoutPath = pathlessCount();
  // Proven when every announced row is accounted for exactly once — as a unique
  // posting, or as a REJECTED path-less row with its raw witness (Nordstrom,
  // 2026-09-09: 1 312 rows read of 1 312 announced, 3 of them path-less, 1 309
  // postings — the historical −3). A repetition across pages only passes when the
  // second sweep has reconciled every announced row.
  const complete = total > 0 && local.size + withoutPath === total && (repeatedIds === 0 || termination === 'SECOND_SWEEP_RECONCILED') && termination !== 'PAGE_BUDGET_EXHAUSTED' && !totalChanged && !capped;
  return { scope: board.scope, total, uniqueIds: local.size, pages, rawCount, repeatedIds, withoutPath, overlap, fresh, termination, complete, totalChanged, capped };
}

export async function fetchWorkdayJobs(config: Record<string, unknown>): Promise<AdapterResult> {
  const { tenant, site, origin } = workdayPortal(config);
  const endpoint = `${origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`;
  const shared: Shared = { endpoint, origin, site, prefixRule: locationPrefixRule(config), out: [], seen: new Set(), pageEvidence: [], issues: new Set(), rejectedRows: [], pathlessRows: new Set(), coverIds: new Set() };
  const { out, seen, pageEvidence, issues, rejectedRows } = shared;

  /**
   * Partition by a facet (2026-09-10, Tapestry). Workday's `total` is CAPPED at
   * 2 000 on that tenant: pages are still served at offsets 2 000, 2 080 and 2 100
   * while the three values of the facet "Brand" enumerate 2 085 distinct postings
   * with no overlap. Read per facet value, each board stays under the cap, the
   * source total is the sum of the boards, and every posting carries the tenant's
   * own attribution as its employer. Opt-in per Source (`partitionFacet`): the
   * facet must exist on the tenant; when it does not, the whole site is read as
   * before and the absence is named.
   */
  const partitionFacet = typeof config.partitionFacet === 'string' && config.partitionFacet.trim() ? config.partitionFacet.trim() : undefined;
  let publisherTotal = 0;
  let boards: Board[] = [{ appliedFacets: {}, scope: 'jobs' }];
  if (partitionFacet) {
    const first = await readPage(shared, boards[0]!, 0);
    publisherTotal = first.total ?? 0;
    const facet = first.facets?.find((f) => f.facetParameter === partitionFacet);
    const values = (facet?.values ?? []).filter((v): v is Required<WorkdayFacetValue> => Boolean(v.id && v.descriptor));
    pageEvidence.push({ url: `${endpoint}#facets`, checkedAt: captureObservedAt().toISOString(), sha256: createHash('sha256').update(JSON.stringify(first)).digest('hex'), offset: 0, pagination: null,
      ids: [], publisherCounter: publisherTotal ? `total=${publisherTotal}` : '', componentCounters: values.map((v) => `${partitionFacet}=${v.descriptor}:${v.count ?? ''}`) });
    // The site itself is read last: a posting that carries no value of the facet belongs to no partition
    // (Tapestry: 6 postings, career-fair and corporate rows without a brand) and keeps the detail-based attribution.
    if (values.length) boards = [...values.map((v): Board => ({ appliedFacets: { [partitionFacet]: [v.id] }, scope: `${partitionFacet}=${v.descriptor}`, partition: { parameter: partitionFacet, value: v.descriptor, id: v.id } })), { appliedFacets: {}, scope: 'jobs:unpartitioned', remainder: true }];
    else issues.add('PARTITION_FACET_ABSENT');
  }
  const results: BoardResult[] = [];
  for (const board of boards) results.push(await enumerateBoard(shared, board));
  const partitioned = Boolean(boards[0]?.partition);
  // Only a capped site read without any partition goes on to the covering facet: every other board is untouched.
  const covering = !partitioned && results[0]?.capped ? await readCoveringFacetSafely(shared, results[0]!) : undefined;
  if (covering) {
    const coverPages = covering.results.reduce((sum, r) => sum + r.pages, 0);
    const enumeration: AdapterResult['enumeration'] = { method: 'PUBLISHER_TOTAL_COUNT_JSON_PAGINATION_COVERING_FACET', endpoint,
      pages: results[0]!.pages + coverPages, rawCount: results[0]!.rawCount + covering.results.reduce((sum, r) => sum + r.rawCount, 0),
      termination: covering.termination, issues: [...issues], enumerationTraversalComplete: covering.reconciled,
      canonicalAbsenceProofUsable: shared.pathlessRows.size === 0,
      scopes: [{ scope: 'jobs', declaredTotal: covering.sigma, uniqueIds: shared.coverIds.size, pages: results[0]!.pages + coverPages, complete: covering.reconciled },
        { scope: 'jobs:capped-site', declaredTotal: results[0]!.total || -1, uniqueIds: results[0]!.uniqueIds, pages: results[0]!.pages, complete: false },
        ...covering.results.map((r): Scope => ({ scope: r.scope, declaredTotal: r.total || -1, uniqueIds: r.uniqueIds, pages: r.pages, complete: r.complete }))],
      pageEvidence };
    const truncated = covering.results.some((r) => r.termination === 'PAGE_BUDGET_EXHAUSTED' || (r.total > 0 && r.rawCount < r.total));
    // `complete` reste faux même quand les comptes concordent : voir `readCoveringFacet`, « la preuve n'est pas adoptée ».
    return finishWorkday(config, out, { declaredTotal: covering.sigma, complete: false, truncated, enumeration, rejectedRows }, origin, tenant, site);
  }
  const partitions = results.filter((r) => r.scope !== 'jobs:unpartitioned');
  const remainder = partitioned ? results.find((r) => r.scope === 'jobs:unpartitioned') : undefined;
  const unpartitioned = remainder?.fresh ?? 0;
  const total = partitions.reduce((sum, r) => sum + r.total, 0) + unpartitioned;
  const pagesRead = results.reduce((sum, r) => sum + r.pages, 0) + (partitionFacet ? 1 : 0);
  const rawCount = results.reduce((sum, r) => sum + r.rawCount, 0);
  const overlap = partitions.reduce((sum, r) => sum + r.overlap, 0);
  const capped = partitioned && publisherTotal > 0 && total > publisherTotal;
  if (partitioned) {
    if (capped) issues.add('PUBLISHER_TOTAL_CAPPED');
    if (overlap) issues.add('PARTITION_OVERLAP');
    if (unpartitioned) issues.add(`UNPARTITIONED_POSTINGS=${unpartitioned}`);
  }
  /**
   * Under a capped site total, postings without a facet value beyond the cap are unobservable: not provable.
   *
   * Tempting shortcut, examined and REJECTED on 2026-09-11: "the residual sweep reported complete, so we saw
   * everything". It proves nothing. The residual is reachable ONLY through the capped site listing, so its
   * `complete: true` says the rows it was SERVED were fully read — never that no further unbranded posting
   * exists beyond the cap. The fixture of `workday.partition.test.ts` is exactly that case: the site serves
   * 2 000 of 2 085 rows, 87 branded postings stay invisible, and each partition still reports complete.
   *
   * So Tapestry stays NOT PROVEN, and that is the honest answer: 5 postings of its board are unreachable. It is
   * reported as an open dossier rather than forced to PROVEN.
   */
  if (capped && unpartitioned) issues.add('UNPARTITIONED_UNDER_CAP');
  const failing = partitions.find((r) => !r.complete) ?? (remainder && !remainder.complete ? remainder : undefined);
  const complete = !failing && overlap === 0 && !(capped && unpartitioned > 0);
  const termination = partitioned ? (failing ? failing.termination : overlap ? 'PARTITION_OVERLAP' : capped && unpartitioned ? 'UNPARTITIONED_UNDER_CAP' : 'PARTITIONS_RECONCILED') : results[0]!.termination;
  if (!complete) issues.add('ENUMERATION_NOT_PROVEN');
  const boardScopes: Scope[] = results.map((r) => ({ scope: r.scope, declaredTotal: r.scope === 'jobs:unpartitioned' ? r.fresh : r.total || -1, uniqueIds: r.scope === 'jobs:unpartitioned' ? r.fresh : r.uniqueIds, pages: r.pages, complete: r.complete }));
  /**
   * DEUX PROPRIÉTÉS DISTINCTES, et c'est ici qu'elles se séparent.
   *
   * Une ligne sans `externalPath` a bien été OBSERVÉE, mais elle n'a aucun identifiant canonique : on ne peut
   * pas la nommer dans la preuve, et on refuse d'en FABRIQUER un depuis le titre ou un hachage — ce serait
   * inventer. Conséquence : le parcours du listing peut être complet (`enumerationTraversalComplete`) alors
   * qu'une absence n'y est pas démontrable (`canonicalAbsenceProofUsable`), puisqu'un identifiant historique
   * disparu pourrait être précisément l'une de ces lignes anonymes.
   *
   * Les offres identifiables du run sont ingérées normalement : seule l'attestation d'absence est refusée.
   */
  const canonicalAbsenceProofUsable = shared.pathlessRows.size === 0;
  const enumeration: AdapterResult['enumeration'] = { method: partitioned ? 'PUBLISHER_TOTAL_COUNT_JSON_PAGINATION_PARTITIONED' : 'PUBLISHER_TOTAL_COUNT_JSON_PAGINATION', endpoint, pages: pagesRead, rawCount, termination, issues: [...issues],
    enumerationTraversalComplete: complete, canonicalAbsenceProofUsable,
    scopes: partitioned ? [{ scope: 'jobs', declaredTotal: total || -1, uniqueIds: seen.size, pages: pagesRead, complete }, ...boardScopes] : boardScopes, pageEvidence };

  // F-04: `total` is the tenant's own announced count — the truncation signal.
  const declaredTotal = total || undefined;
  const truncated = partitions.some((r) => r.termination === 'PAGE_BUDGET_EXHAUSTED' || (r.total > 0 && r.rawCount < r.total));
  return finishWorkday(config, out, { declaredTotal, complete, truncated, enumeration, rejectedRows }, origin, tenant, site);
}

/** The listing read; the detail of each posting is attached unless the source reads the listing only. */
async function finishWorkday(config: Record<string, unknown>, out: NormalizedJob[], result: Omit<AdapterResult, 'jobs'>, origin: string, tenant: string, site: string): Promise<AdapterResult> {
  if (config.withDescriptions === false) return { jobs: out.map(job => ({ ...job, publicationHold: 'WORKDAY_LISTING_WITHOUT_EMPLOYER_DETAIL' })), ...result };
  return {
    // D-517 : en lecture incrémentale, la fiche n'est lue que pour une publication jamais vue (une requête par offre).
    jobs: await attachWorkdayDescriptions(
      out.filter(job => !isKnownPosting(job.externalId)),
      `${origin}/wday/cxs/${tenant}/${site}`,
      Number(config.detailConcurrency ?? 4),
    ),
    ...result,
  };
}

/** One facet of the site's first page whose values are flat, each named and counted: what a covering board can apply. */
type FlatFacet = { parameter: string; values: Required<WorkdayFacetValue>[]; sum: number };
export type CoveringFacet = FlatFacet & {
  /** Flat facets of the page whose counts add up to exactly `sum` (the covering facet included). */
  agreeing: number;
  /** A flat facet counts MORE postings than the covering one: some postings carry no value of it. */
  exceeded: boolean;
};

function flatFacets(facets: readonly WorkdayFacet[] | undefined): FlatFacet[] {
  return (facets ?? []).flatMap((facet) => {
    const values = facet.values ?? [];
    if (!facet.facetParameter || !values.length) return [];
    // A nested facet (`locationMainGroup`: country → city) counts a posting under several levels: never a partition.
    if (values.some((v) => 'values' in (v as object) || !v.id || !v.descriptor || !Number.isSafeInteger(v.count) || v.count! < 0)) return [];
    const flat = values as Required<WorkdayFacetValue>[];
    return [{ parameter: facet.facetParameter, values: flat, sum: flat.reduce((total, v) => total + v.count, 0) }];
  });
}

/**
 * LA FACETTE COUVRANTE D'UN SITE PLAFONNÉ (D-520, lecture D-492 du 02/10/2026). Pure ; exportée pour son témoin.
 *
 * Workday ne déclare jamais plus de `WORKDAY_TOTAL_CAP` offres et, au-delà, ressert la même page (knitwell le 02/10 :
 * offsets 2 000, 3 000, 3 500 et 3 520, même première offre) : la liste du site ne peut pas être lue jusqu'au bout. Ses
 * facettes, elles, comptent le tableau entier : knitwell en tient 3 515 (Job Family, State, Job Type et Time Type
 * donnent toutes 3 515). Lu par chaque valeur d'une facette dont aucune valeur n'atteint le plafond, chaque tableau est
 * lisible jusqu'au bout. La facette retenue est celle qui compte le plus d'offres, puis celle qui a le moins de
 * valeurs (le moins de requêtes), puis par nom. Aucune : `undefined`, la lecture reste celle d'avant.
 */
export function coveringFacet(facets: readonly WorkdayFacet[] | undefined, cap = WORKDAY_TOTAL_CAP): CoveringFacet | undefined {
  const flat = flatFacets(facets);
  const candidates = flat.filter((f) => f.sum >= cap && f.values.every((v) => v.count < cap))
    .sort((a, b) => b.sum - a.sum || a.values.length - b.values.length || a.parameter.localeCompare(b.parameter));
  const chosen = candidates[0];
  if (!chosen) return undefined;
  return { ...chosen, agreeing: flat.filter((f) => f.sum === chosen.sum).length, exceeded: flat.some((f) => f.sum > chosen.sum) };
}

/**
 * LIRE UN SITE PLAFONNÉ PAR SA FACETTE COUVRANTE (D-520, lecture D-492 du 02/10/2026).
 *
 * Mesuré : knitwell-us-retail lisait 2 000 offres sur 3 515 chaque jour (« énumération réfutée,
 * PUBLISHER_TOTAL_CAPPED », échec connu D-480) ; 1 515 offres en ligne n'entraient jamais au catalogue. Chaque valeur
 * de la facette couvrante est lue comme un tableau ordinaire, sous son propre total (< plafond), avec ses deux
 * relectures (total changé, tri instable). Les offres déjà servies par le site ne sont pas recomptées ; la facette
 * n'attribue AUCUN employeur (une famille de métiers n'est pas une Maison) : l'attribution reste celle du détail.
 *
 * LA PREUVE, et toutes ses conditions : chaque tableau prouvé sous son total ; aucune offre dans deux valeurs ; la somme
 * des totaux des tableaux égale le compte de la facette ; identifiants distincts + lignes sans chemin = ce compte ;
 * chaque offre servie par le site plafonné retrouvée dans les tableaux ; au moins DEUX facettes à plat comptent
 * exactement ce même total et aucune n'en compte davantage. La dernière condition est la seule inférence : une offre
 * sans valeur de la facette ET servie au-delà du plafond resterait invisible ; elle ferait compter une autre facette
 * de plus, sauf à n'avoir aucune valeur dans aucune. Elle est écrite ici, pas cachée.
 *
 * LA PREUVE N'EST PAS ADOPTÉE (audit du 02/10/2026). Quand toutes ces conditions tiennent, la terminaison est
 * `COVERING_FACET_RECONCILED` et la preuve est archivée (portées, compteurs), mais la sortie reste `complete: false` avec
 * `COVERING_FACET_PROOF_NOT_ADOPTED` : transmise, elle donnerait `canAttestAbsence`, ouvrirait la chute confirmée de
 * D-484 §2 et les retenues de disponibilité (`availability.ts`), qui ne lisent pas la terminaison. Décider qu'une lecture
 * par facette fait preuve appartient au propriétaire (`refreshPlan.ts`). Jusque-là : toutes les offres sont collectées,
 * aucune n'est fermée ni retenue sur cette lecture, et knitwell reste sous D-480 §1.
 */
async function readCoveringFacet(shared: Shared, site: BoardResult): Promise<{ sigma: number; results: BoardResult[]; reconciled: boolean; termination: string } | undefined> {
  const cover = coveringFacet(shared.siteFacets);
  if (!cover) { shared.issues.add('COVERING_FACET_ABSENT'); return undefined; }
  const siteIds = [...shared.seen];
  // `canonicalIds: []` : une page d'inventaire ne nomme aucune offre ; sans la propriété, le contrat canonique serait partiel.
  shared.pageEvidence.push({ url: `${shared.endpoint}#coveringFacet=${encodeURIComponent(cover.parameter)}`, checkedAt: captureObservedAt().toISOString(),
    sha256: createHash('sha256').update(JSON.stringify(shared.siteFacets)).digest('hex'), offset: 0, pagination: null, ids: [], canonicalIds: [], publisherCounter: `total=${site.total}`,
    componentCounters: [...cover.values.map((v) => `${cover.parameter}=${v.descriptor}:${v.count}`), `sum=${cover.sum}`, `agreeing=${cover.agreeing}`, ...(cover.exceeded ? ['exceeded=1'] : [])] });
  const results: BoardResult[] = [];
  // A value counted at zero has nothing to read; its zero still adds up in the facet's sum.
  for (const v of cover.values.filter((value) => value.count > 0))
    results.push(await enumerateBoard(shared, { appliedFacets: { [cover.parameter]: [v.id] }, scope: `${cover.parameter}=${v.descriptor}`, cover: { parameter: cover.parameter, value: v.descriptor, id: v.id } }));
  shared.issues.add(`COVERED_BY_FACET=${cover.parameter}`);
  const overlap = results.reduce((sum, r) => sum + r.overlap, 0);
  const boardsTotal = results.reduce((sum, r) => sum + r.total, 0);
  const withoutPath = results.reduce((sum, r) => sum + r.withoutPath, 0);
  const outside = siteIds.filter((id) => !shared.coverIds.has(id)).length;
  const failures = [
    ...(results.some((r) => !r.complete) ? ['COVERING_BOARD_UNPROVEN'] : []),
    ...(overlap ? [`COVERING_FACET_OVERLAP=${overlap}`] : []),
    ...(boardsTotal !== cover.sum || shared.coverIds.size + withoutPath !== cover.sum ? [`COVERING_FACET_TOTAL_MISMATCH=${shared.coverIds.size + withoutPath}/${cover.sum}`] : []),
    ...(outside ? [`COVERING_FACET_MISSES_SITE_POSTINGS=${outside}`] : []),
    ...(cover.agreeing < 2 || cover.exceeded ? ['COVERING_FACET_WITHOUT_AGREEMENT'] : []),
  ];
  for (const failure of failures) shared.issues.add(failure);
  const reconciled = failures.length === 0;
  shared.issues.add(reconciled ? 'COVERING_FACET_PROOF_NOT_ADOPTED' : 'ENUMERATION_NOT_PROVEN');
  return { sigma: cover.sum, results, reconciled, termination: reconciled ? 'COVERING_FACET_RECONCILED' : 'COVERING_FACET_UNPROVEN' };
}

/**
 * La lecture couvrante ajoute des centaines de requêtes à une source déjà lue : une erreur de l'une d'elles ne doit pas
 * coûter la source entière. Les offres du site plafonné restent collectées et l'échec est nommé ; une interruption de la
 * source (délai, arrêt du pipeline) se propage comme avant.
 */
async function readCoveringFacetSafely(shared: Shared, site: BoardResult): Promise<Awaited<ReturnType<typeof readCoveringFacet>>> {
  try { return await readCoveringFacet(shared, site); }
  catch (error) {
    assertSourceRunning();
    shared.issues.add(`COVERING_FACET_READ_FAILED:${String(error instanceof Error ? error.message : error).slice(0, 200)}`);
    return undefined;
  }
}

type WorkdayDetail = {
  jobPostingInfo?: {
    externalUrl?: string;
    jobDescription?: string;
    location?: string;
    /** English label in en-US ("Taiwan Region", "United States of America"); the boundary maps it to ISO. */
    country?: { descriptor?: string };
    startDate?: string;
    /** Fin de publication ("2026-09-12") — validThrough, jamais lu avant l2. */
    endDate?: string;
    /** "Full time" / "Part time" / "Variable" — jamais lu avant l2 (14 385 offres sans temps). */
    timeType?: string;
    /** "Hybrid", "Remote", "On-site" quand le tenant le publie. */
    remoteType?: string;
    /** On group tenants, the alt text IS the brand ("Panerai", "Cartier"). */
    logoImage?: { alt?: string };
  };
  /** Legal entity, code-prefixed: "C170 Officine Panerai". */
  hiringOrganization?: { name?: string };
};

/**
 * The Maison this posting belongs to, on a GROUP tenant (audit A-01, D11).
 *
 * Verified live on richemont/broadbean_external: jobPostingInfo.logoImage.alt
 * = "Panerai", hiringOrganization.name = "C170 Officine Panerai". Without this,
 * every offer of the feed inherits the catalogue line's label and 1 300+
 * Richemont offers all read "Cartier".
 */
/**
 * The logo alt text names the brand, sometimes with the word "logo" glued to it
 * ("Cartier Logo", "Richemont Logo", "Logo Pierre Fabre", "Jaeger LeCoultre logo"
 * — 516 postings on 2026-09-09 whose new spellings the identity gate refused).
 * The word is the image's, not the employer's.
 */
export function brandFromLogoAlt(alt: string | undefined): string | undefined {
  // The alt may be a file-name-like token: "Off_The_Rax_LOGO300x300" (KnitWell, 2026-09-10) — underscores separate words and the
  // image word may carry its dimensions. Only the word "logo" (with optional WxH) is removed; every other word is the brand.
  const name = alt?.replace(/_+/g, ' ').replace(/(^|\s)logo(?:\s*\d+\s*x\s*\d+)?(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
  return name && !/^logo$/i.test(name) ? name : undefined;
}

export function brandFromWorkdayDetail(detail: WorkdayDetail): string | undefined {
  const alt = brandFromLogoAlt(detail.jobPostingInfo?.logoImage?.alt);
  if (alt) return alt;
  const legal = detail.hiringOrganization?.name?.trim();
  if (!legal) return undefined;
  // Strip the leading entity code ("C170 Officine Panerai" -> "Officine Panerai").
  return legal.replace(/^[A-Z]{0,2}\d+\s+/, '').trim() || undefined;
}

/**
 * Workday's listing states the date RELATIVELY ("Posted Today", "Posted 3 Days
 * Ago") — F-05. "30+ Days Ago" is a floor, not a date: left undefined rather
 * than invented; the detail's `startDate` (a real ISO date) overrides when the
 * descriptions pass fetches it, and firstSeenAt covers the rest honestly.
 */
export function postedAtFromWorkday(postedOn?: string, observedAt = captureObservedAt()): Date | undefined {
  if (!postedOn) return undefined;
  const text = postedOn.toLowerCase();
  const day = 86_400_000;
  if (/\btoday\b/.test(text)) return new Date(observedAt);
  if (/\byesterday\b/.test(text)) return new Date(observedAt.getTime() - day);
  const match = text.match(/(\d+)\+?\s+days?\s+ago/);
  if (!match) return undefined;
  if (text.includes('+')) return undefined; // "30+" = at least, not equals
  return new Date(observedAt.getTime() - Number(match[1]) * day);
}


/**
 * LA FICHE QUE L'ÉDITEUR RETIRE (D-484 §1, décision CEO du 30/09/2026).
 *
 * Mesuré sur les 976 captures Workday du 18 au 29/09 (`scripts/ops/workday-fiches-en-echec.mts`) : 16 fiches ont
 * rendu, aux trois essais du transport, `403 {"errorCode":"S22",…,"httpStatus":403,…,"message":"permission denied"}`.
 * Aucune n'est jamais revenue en 200 ; 11 des 13 suivies ont quitté la liste à la capture suivante, les deux autres
 * sept minutes plus tard, encore refusées. C'est l'offre que l'éditeur retire alors que son index la liste encore :
 * une retenue sur preuve de la source, non publiée, visible au bilan, non bloquante (`publicationDisposition.ts`),
 * sous la garde de masse de `health.ts` (au-delà de max(5, 5 %) des fiches d'une source, panne ou blocage).
 *
 * La preuve est le CORPS du refus, jamais le seul statut : un 403 sans ce corps (pare-feu, page HTML, autre code)
 * reste `WORKDAY_DETAIL_FETCH_FAILED`, à instruire. On garde de ce corps ce qui le rend reconnaissable, sans
 * l'identifiant de cas que Workday change à chaque réponse ; collecte et rejeu le lisent dans les mêmes octets.
 */
export const WORKDAY_DETAIL_PERMISSION_DENIED = 'WORKDAY_DETAIL_PERMISSION_DENIED';
export type WorkdayDetailRefusal = { status: 403; errorCode: 'S22'; message: 'permission denied' };
const S22: WorkdayDetailRefusal = { status: 403, errorCode: 'S22', message: 'permission denied' };

export function workdayDetailRefusal(error: unknown): WorkdayDetailRefusal | undefined {
  const { status, body } = (error ?? {}) as { status?: unknown; body?: unknown };
  if (status !== 403 || typeof body !== 'string') return undefined;
  try {
    const native = JSON.parse(body) as { errorCode?: unknown; message?: unknown; httpStatus?: unknown } | null;
    return native?.errorCode === 'S22' && native.message === 'permission denied' && native.httpStatus === 403 ? { ...S22 } : undefined;
  } catch { return undefined; }
}

/** La preuve telle que la retenue la conserve (`raw.detailRefusal`) : le lecteur hors ligne ne relit qu'elle. */
export function retainedWorkdayRefusal(raw: unknown): boolean {
  const refusal = (raw as { detailRefusal?: Record<string, unknown> } | null)?.detailRefusal;
  return !!refusal && typeof refusal === 'object' && Object.keys(refusal).length === 3
    && refusal.status === S22.status && refusal.errorCode === S22.errorCode && refusal.message === S22.message;
}

/**
 * The listing endpoint returns no description; the detail one does, at
 * {cxsBase}{externalPath}. The path must be the FULL externalPath from the
 * listing — a shortened one 404s with "not found: Job_Posting_Anchor_ID".
 */
export async function attachWorkdayDescriptions(
  jobs: NormalizedJob[],
  cxsBase: string,
  concurrency = 4,
): Promise<NormalizedJob[]> {
  const limit = pLimit(concurrency);

  return Promise.all(
    jobs.map((job) =>
      limit(async () => {
        const path = (job.raw as { externalPath?: string } | undefined)?.externalPath;
        if (!path) return { ...job, publicationHold: 'WORKDAY_DETAIL_PATH_MISSING' };
        try {
          // Même locale que la liste : sans cet en-tête, le détail arrive
          // traduit par machine (voir EN_US).
          const detail = await fetchJson<WorkdayDetail>(`${cxsBase}${path}`, { headers: { ...EN_US } });
          return mergeWorkdayDetail(job, detail);
        } catch (error) {
          // D-484 §1 : l'éditeur refuse la fiche en la nommant (403 S22) — l'offre qu'il retire. Sa preuve est gardée.
          const refusal = workdayDetailRefusal(error);
          if (refusal) return { ...job, publicationHold: WORKDAY_DETAIL_PERMISSION_DENIED, raw: { ...(job.raw as Record<string, unknown>), detailRefusal: refusal } };
          // A failed detail is not evidence that the listing belongs to the
          // GROUP printed in the catalogue. Keep the listing and the exact
          // diagnostic as a publication hold; it cannot attest absence.
          // A stack contains execution paths and timing, not publisher data.
          return { ...job, publicationHold: 'WORKDAY_DETAIL_FETCH_FAILED', raw: {
            ...(job.raw as Record<string, unknown>), detailFailure: error instanceof Error
              ? { name: error.name }
              : { name: 'UnknownError' },
          } };
        }
      }),
    ),
  );
}

/** The same native detail reader serves collection and retained-RAW recovery. */
export function mergeWorkdayDetail(job: NormalizedJob, detail: WorkdayDetail): NormalizedJob {
  const info = detail.jobPostingInfo;
  if (!info) return { ...job, raw: { ...(job.raw as Record<string, unknown>), detail }, publicationHold: 'WORKDAY_DETAIL_SCHEMA_INVALID' };
  if (!workdayDetailMatchesListing(job, detail)) return { ...job, raw: { ...(job.raw as Record<string, unknown>), detail }, publicationHold: 'WORKDAY_DETAIL_IDENTITY_MISMATCH' };
  // A posting read on a partition board already carries the tenant's own attribution (facet value):
  // the detail supplies text, dates and country, never a second employer claim.
  // …the same holds for a banner read from the tenant's store code (listing.locationsText.prefix).
  const partitioned = job.employerEvidence?.path.startsWith('listing.') ? job.employerEvidence : undefined;
  const employer = partitioned ? job.company : brandFromWorkdayDetail(detail);
  /**
   * An absent EMPLOYER does not invalidate the FACTS the same detail carries.
   *
   * This branch used to return the listing untouched, so a detail without an employer also dropped its
   * date, country, location and description — two concerns wrongly coupled: WHO hires, and WHAT the
   * posting says. Measured on uniqlo-hkm-headquarters (2026-09-10): two postings kept
   * `jobPostingInfo.startDate` in their archived raw while `postedAt`, `countryCode`, `city` and
   * `description` were all null, purely because their detail carried no employer label.
   * The hold is what protects the identity — it is kept, unchanged, and the posting stays unpublished
   * until an employer is proven. But the descriptive fields are now applied: they come from the same
   * archived document and are not a claim about the employer.
   */
  if (!employer) return {
    ...job,
    raw: { ...(job.raw as Record<string, unknown>), detail },
    publicationHold: 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL',
    description: htmlToPlainText(info.jobDescription) || job.description,
    country: info.country?.descriptor ?? job.country,
    location: info.location || job.location,
    postedAt: info.startDate ? new Date(info.startDate) : job.postedAt,
    validThrough: info.endDate ? new Date(info.endDate) : job.validThrough,
    workingTime: info.timeType || job.workingTime,
    remote: info.remoteType || job.remote,
  };
  return {
    ...job,
    publicationHold: job.publicationHold?.startsWith('WORKDAY_') ? undefined : job.publicationHold,
    // Keep the exact detail that supplied the employer, dates and country.
    // Preserve listing keys for replay and subsequent detail refreshes.
    raw: { ...(job.raw as Record<string, unknown>), detail },
    description: htmlToPlainText(info.jobDescription) || job.description,
    country: info.country?.descriptor ?? job.country,
    location: info.location ?? job.location,
    // F-05: the detail's startDate is a REAL date; the listing only
    // had "Posted N Days Ago".
    postedAt: info.startDate ? new Date(info.startDate) : job.postedAt,
    validThrough: info.endDate ? new Date(info.endDate) : job.validThrough,
    // `||` : Workday rend "" quand le tenant ne remplit pas le champ (2/100 chez Tapestry).
    workingTime: info.timeType || job.workingTime,
    remote: info.remoteType || job.remote,
    // Group tenants: credit the offer to its Maison, not the feed label.
    company: employer,
    // The evidence label is the one the identity gate matches: the brand read from
    // the alt, without the image's word "logo" (bounded lot L3, 2026-09-10: 136
    // postings refused as "HOKA Logo", "Richemont Logo", "Logo Pierre Fabre" while
    // `company` already carried the cleaned brand).
    employerEvidence: partitioned ? partitioned : brandFromLogoAlt(info.logoImage?.alt)
      ? { rawName: brandFromLogoAlt(info.logoImage?.alt)!, path: 'detail.jobPostingInfo.logoImage.alt', rule: /(^|\s)logo(\s|$)/i.test(info.logoImage!.alt!) ? 'LOGO_ALT_WORD_REMOVED' : 'LOGO_ALT' }
      : detail.hiringOrganization?.name?.trim()
        ? { rawName: detail.hiringOrganization.name, path: 'detail.hiringOrganization.name', rule: /^[A-Z]{0,2}\d+\s+/.test(detail.hiringOrganization.name.trim()) ? 'LEADING_ENTITY_CODE_REMOVED' : 'HIRING_ORGANIZATION_LABEL' }
        : job.employerEvidence,
  };
}

export function parseWorkdayPublication(raw: WorkdayPosting & { detail?: WorkdayDetail; facet?: Board['partition'] }, config: Record<string, unknown>, observedAt: Date): NormalizedJob | null {
  if (!raw.externalPath || !raw.title || !raw.detail || !config.origin || !config.site) return null;
  const externalId = raw.externalPath.split('/').filter(Boolean).pop();
  if (!externalId) return null;
  const listing = toJob({ origin: String(config.origin), site: String(config.site), prefixRule: locationPrefixRule(config) },
    { partition: raw.facet }, raw, externalId, observedAt);
  return mergeWorkdayDetail(listing, raw.detail);
}
