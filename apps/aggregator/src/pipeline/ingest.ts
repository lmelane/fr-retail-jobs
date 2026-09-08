import type { PrismaClient, AtsType } from '@prisma/client';
import type { SourceTier } from '../dedup/match.js';
import { loadActiveSources, type RuntimeSource } from '../connectors/sourceStore.js';
import { classifySector } from '../normalize/sector.js';
import { resolveCompany } from '../normalize/company.js';
import { domainFromEmployerSources } from '../normalize/companyDomain.js';
import { readEmployment, decomposeCompositeCode, extractEmployment, type Employment } from '../normalize/employment.js';
import { extractSalaryBand } from '../normalize/salary.js';
import { isFranceJob } from '../lib/france.js';
import { htmlToPlainText } from '../lib/html.js';
import { coerceAmount, coerceCoordinate, coerceText, cleanTitle, cleanPlace, plausiblePostedAt, canonicalPeriod, canonicalRemote, boundedSalary, briefError } from '../lib/normalize.js';
import { normalizeSourceConfig } from '../connectors/sourceConfig.js';
import { isRotatingSource, nextPageFor, advanceCursor } from './sourceCursor.js';
import { upsertDeduplicated } from '../dedup/upsert.js';
import type { CandidateJob } from '../dedup/match.js';
import type { NormalizedJob } from '../types.js';
import { PIPELINE_VERSION } from './version.js';
import { runGeocode } from './geocodeJobs.js';
import { purgeStaleForSource } from './purge.js';
import { isTrustedForAttestation } from './attestation.js';
import { fetchAtsJobs } from '../ats/index.js';

/**
 * INGEST — picks up new and updated offers.
 *
 * Runs often and stays light: it reads sitemaps and feeds, then writes through
 * the deduplicating upsert so a duplicate never reaches the database, not even
 * for a second. Sector filtering happens BEFORE any write — on one Welcome to the
 * Jungle shard only 4.2% of French offers were in our vertical, so admitting
 * everything would drown the base in noise.
 */

export type IngestStats = {
  source: string;
  fetched: number;
  inSector: number;
  france: number;
  created: number;
  merged: number;
  updated: number;
  errors: number;
  /**
   * Field-coverage counters (audit L-02 generalized, décision Loïc 2026-09-03):
   * a source can return the right VOLUME while silently losing a field — the
   * Eightfold descriptions vanished on 3 780 offers behind a renamed API key,
   * LVMH ships no dates, Teamtailor can ship empty URLs. Health gates on these.
   */
  withDescription: number;
  withDate: number;
  withCountry: number;
  withUrl: number;
  /** Count the SOURCE declares for its listing, when it announces one (F-04). */
  declaredTotal?: number;
  /** True when the sweep returned fewer offers than declaredTotal. */
  truncated?: boolean;
};

/**
 * Ce que l'écriture doit savoir d'une source : sa clé, sa Maison de repli, son
 * rang de dédup, son domaine carrière. Le registre codé en dur qui portait ce
 * type a été supprimé (audit A2, 2026-09-06) : ses six routes sitemap
 * doublaient des sources de la table Source (courir, galeries-lafayette,
 * lacoste : 663 offres affichées deux fois) ou tournaient à vide (puig 21 runs
 * à zéro, wttj 14 offres pour 2 552 pages challengées, decathlon 104 pages
 * sur 1 240 à chaque run). La table Source est la seule source du catalogue (D28).
 */
type SourceDef = { key: string; company: string; tier: SourceTier; careersDomain?: string };

/** One place decides what "the field is filled" means, for every ingest path. */
export function noteFieldCoverage(stats: IngestStats, job: NormalizedJob): void {
  if ((job.description?.length ?? 0) >= 200) stats.withDescription++;
  if (job.postedAt) stats.withDate++;
  if (job.country) stats.withCountry++;
  if (/^https?:\/\//.test(job.url ?? '')) stats.withUrl++;
}

function toCandidate(
  job: NormalizedJob,
  source: SourceDef,
  companyName: string,
  atsType: AtsType,
): CandidateJob & { companyId: string } {
  // F-06: the apply link is the product promise — a candidate clicking
  // "Voir l'offre" must land somewhere. A relative path, an empty string or a
  // javascript: pseudo-URL is refused AT THE BOUNDARY (counted as an error on
  // the source), never stored for the web layer to render as a dead button.
  if (!/^https?:\/\//.test(job.url ?? '')) {
    throw new Error(`invalid apply URL "${(job.url ?? '').slice(0, 80)}" (${job.externalId})`);
  }
  // Le texte propre AVANT toute lecture : certaines sources publient du HTML
  // brut (Greenhouse), d'autres du HTML échappé (Teamtailor). Fait une seule
  // fois ici, pour que la lecture des dimensions et du salaire lise du texte,
  // et pour que la base ne contienne que du propre.
  const description = htmlToPlainText(job.description);

  /**
   * LES CINQ DIMENSIONS D'EMPLOI, par ordre de fiabilité de la preuve.
   *
   * L'ordre suit la règle posée : un champ structuré de la source bat le titre,
   * qui bat la description. Chaque source de preuve ne REMPLIT que les
   * dimensions encore vides — une preuve plus faible n'écrase jamais une plus
   * forte. Les dimensions sont indépendantes : « CDD 35H saisonnier » renseigne
   * la durée, le rythme ET le drapeau saisonnier, sans arbitrage entre eux.
   */
  const employment: Employment = {};
  const fill = (from: Employment) => {
    if (!employment.employmentTerm && from.employmentTerm) employment.employmentTerm = from.employmentTerm;
    if (!employment.workTime && from.workTime) employment.workTime = from.workTime;
    if (!employment.programType && from.programType) employment.programType = from.programType;
    if (!employment.engagementType && from.engagementType) employment.engagementType = from.engagementType;
    if (!employment.isSeasonal && from.isSeasonal) employment.isSeasonal = true;
  };

  // 1. Les champs dédiés de la source. `decomposeCompositeCode` d'abord : un
  //    code comme « parttime_fixed_term » porte DEUX dimensions, et le lire
  //    comme un mot unique en perdrait une (225 offres mesurées).
  fill(decomposeCompositeCode(job.contract));
  fill(readEmployment(job.contract));
  fill(readEmployment(job.workingTime));
  // 2. Le titre puis la description, pour ce que les champs n'ont pas dit.
  fill(extractEmployment(job.title, description));

  // Coerce the structured salary at the boundary: a schema.org feed (Teamtailor)
  // hands minValue/maxValue over as strings ("75000"), and written through to an
  // Int? column that crashed job.create and lost the offer. A non-number becomes
  // undefined, which then lets the text extraction below recover a band.
  const salaryMin = coerceAmount(job.salaryMin);
  const salaryMax = coerceAmount(job.salaryMax);

  // Salary from prose when the structured field is empty: Galeries Lafayette
  // writes the band in the text, and a fiche without it reads half-finished.
  const salaryFromText =
    salaryMin === undefined && salaryMax === undefined ? extractSalaryBand(description) : null;

  return {
    ...job,
    // Titre nettoyé (entités, espaces parasites : 2 400 offres, audit A1) ; lieu et
    // ville sans balise (« /a> » sur 71 offres L'Oréal) ; date de publication
    // plausible (5 offres « publiées en 2028 ») ; salaire borné pour les devises
    // majeures (58 M€/an chez Michael Page).
    title: cleanTitle(job.title) ?? job.title,
    location: cleanPlace(job.location),
    city: cleanPlace(job.city),
    postedAt: plausiblePostedAt(job.postedAt),
    description,
    ...boundedSalary(salaryMin, salaryMax, job.salaryCurrency),
    // String columns, coerced at the boundary: TalentView sends NUMERIC ids for
    // the currency ("1") and remote level, which crashed every write ("Expected
    // String, provided Int"). Coercing here means no adapter can ever leak the
    // wrong type into these columns again — the adapter's own mapping is the
    // readable value, this is the guardrail.
    salaryCurrency: coerceText(job.salaryCurrency)?.toUpperCase(),
    salaryPeriod: canonicalPeriod(job.salaryPeriod),
    remote: canonicalRemote(job.remote),
    // Float columns: Rituals shipped "52.37" as a string and lost 577 offers.
    latitude: coerceCoordinate(job.latitude, 90),
    longitude: coerceCoordinate(job.longitude, 180),
    // Chaque dimension reste VIDE quand la source ne la dit pas : l'absence
    // d'information est un vide, pas une valeur. (L'ancien « UNKNOWN » stocké
    // était truthy, et l'écran affichait « Contrat : UNKNOWN » sur chaque offre
    // dont la source omettait le champ.)
    ...employment,
    ...(salaryFromText
      ? {
          salaryMin: salaryFromText.min,
          salaryMax: salaryFromText.max,
          salaryCurrency: 'EUR',
          salaryPeriod: salaryFromText.period,
        }
      : {}),
    // The resolved display name, not the raw source string: group ATS feeds
    // label every posting "<lead brand> +N", and that counter would otherwise
    // become the stored company name a candidate reads. resolveCompany strips it
    // and maps known brands to their canonical spelling, so the Company row, the
    // dedup key and the card all agree on one name.
    ...(() => {
      const identity = resolveCompany(companyName);
      return {
        company: identity.displayName,
        companyId: identity.companyId,
        // The Maison's domain, for its logo — only when THIS source is the
        // Maison's own careers site (tier + name resolve to the same company)
        // and the host is not an ATS vendor's. No network: read off the row.
        companyDomain:
          domainFromEmployerSources(identity.companyId, [
            { maison: source.company, tier: source.tier, careersDomain: source.careersDomain },
          ]) ?? undefined,
      };
    })(),
    sourceKey: source.key,
    sourceTier: source.tier,
    atsType,
  };
}



/** Catalogue `kind` -> the dispatcher's AtsType. */
export const KIND_TO_ATS: Record<string, string> = {
  successfactors: 'SUCCESSFACTORS',
  avature: 'AVATURE',
  eightfold: 'EIGHTFOLD',
  wttj: 'WTTJ',
  /**
   * Balayage sectoriel WTTJ (w1, 2026-09-06) : même AtsType que `wttj` pour
   * que la même offre lue par les deux chemins soit UNE identité
   * (companyId, WTTJ, externalId) — l'adaptateur branche sur la config.
   */
  'wttj-sector': 'WTTJ',
  workday: 'WORKDAY',
  magnet: 'MAGNET',
  teamtailor: 'TEAMTAILOR',
  'smartrecruiters-whitelabel': 'SMARTRECRUITERS',
  workable: 'WORKABLE',
  talentview: 'TALENTVIEW',
  phenom: 'PHENOM',
  recruitee: 'RECRUITEE',
  lvmh_algolia: 'LVMH_ALGOLIA',
  ashby: 'ASHBY',
  lever: 'LEVER',
  pinpoint: 'PINPOINT',
  greenhouse: 'GREENHOUSE',
  gestmax: 'GENERIC_JSONLD',
  radancy: 'GENERIC_JSONLD',
  digitalrecruiters: 'DIGITALRECRUITERS',
  talentsoft: 'TALENTSOFT',
  personio: 'PERSONIO',
  eightfold_kering: 'EIGHTFOLD',
  wordpress: 'WORDPRESS',
  fashionjobs: 'FASHIONJOBS',
  'generic-listing': 'GENERIC_JSONLD',
  oraclehcm: 'ORACLE_HCM',
  taleo: 'TALEO',
  altamira: 'ALTAMIRA',
  jobylon: 'JOBYLON',
  rituals: 'RITUALS',
  talentfunnel: 'TALENT_FUNNEL',
  bashtalents: 'BASH_TALENTS',
  eqwa: 'EQWA',
  geodirectory: 'GEODIRECTORY',
  typesense: 'TYPESENSE',
  jibe: 'JIBE',
  volcanic: 'VOLCANIC',
  // iCIMS : adaptateur et dispatch existaient, le kind manquait ici — URBN (1 329 + 906) et
  // Aéropostale (17) ACTIVE n'ont jamais tourné, sans aucun signal (audit A2, 2026-09-06).
  icims: 'ICIMS',
  swatchgroup: 'SWATCH_GROUP',
};

/**
 * One API-backed catalogue feed: one listing call, then the write-time dedup.
 *
 * This path was MISSING: runIngest only ever consumed sitemap sources, so the
 * nineteen adapters — LVMH's 1200, Parfums Chanel's 1086, Kering's 1008 —
 * were tested, validated, and then called by nothing. The catalogue said
 * 20,378 offers; the pipeline could reach a fraction of them.
 */
async function ingestApiSource(
  prisma: PrismaClient,
  source: RuntimeSource,
  deadlineMs?: number,
): Promise<IngestStats> {
  const stats: IngestStats = {
    source: source.key,
    fetched: 0, inSector: 0, france: 0, created: 0, merged: 0, updated: 0, errors: 0,
    withDescription: 0, withDate: 0, withCountry: 0, withUrl: 0,
  };

  const type = KIND_TO_ATS[source.kind];
  if (!type) {
    console.error(`[ingest] ${source.maison}: no adapter for kind "${source.kind}"`);
    stats.errors = 1;
    return stats;
  }

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(source.entryUrl || '{}');
  } catch {
    // Legacy rows keep a plain URL there; adapters that need one read origin.
    config = { origin: source.entryUrl };
  }

  // Resolve config-key synonyms before the adapter reads it: a discovery batch
  // may have written `careers_url` where the Teamtailor adapter expects
  // `origin`, and the unrecognised key fetched nothing — the live "origin
  // missing" failures. validateSources already did this; now the ingest agrees.
  // The deadline rides along so a slow crawler (FashionJobs) stops gracefully.
  config = { ...normalizeSourceConfig(config), deadlineMs };

  // A rotating source resumes partway through its listing so it re-sees every
  // offer within the lifecycle window instead of only ever the newest pages.
  const rotating = isRotatingSource(stats.source);
  const progress: { reachedEnd?: boolean; lastPageDone?: number } = {};
  let startPage = 1;
  if (rotating) {
    startPage = await nextPageFor(prisma, stats.source);
    config = { ...config, startPage, progress };
  }

  const { jobs, declaredTotal, truncated } = await fetchAtsJobs(type as never, config);
  stats.declaredTotal = declaredTotal;
  stats.truncated = truncated;
  if (truncated) {
    console.error(
      `[ingest] ${stats.source}: TRUNCATED — ${jobs.length} collected of ${declaredTotal} declared`,
    );
  }

  // Move the cursor forward for next run — after a successful fetch only, so a
  // failed crawl retries the same window rather than skipping it.
  if (rotating) {
    const next = await advanceCursor(
      prisma,
      stats.source,
      startPage,
      progress.reachedEnd === true,
      progress.lastPageDone,
    );
    console.log(`[ingest] ${stats.source}: rotating crawl page ${startPage} → next run resumes at ${next}`);
  }
  stats.fetched = jobs.length;

  const sourceDef: SourceDef = {
    key: stats.source,
    company: source.maison.split('(')[0].trim(),
    tier: source.tier as SourceTier,
    careersDomain: source.careersDomain || undefined,
  };

  /**
   * Filtre sectoriel OPT-IN par source (`config.filterSector: true`), jamais
   * déduit du rang : le rang « jobboard » couvre aussi la page WTTJ d'UNE Maison
   * (Diptyque, A.P.C., Fusalp…) et les cabinets spécialisés (Luxe Talent), dont
   * chaque offre est dans le secteur par construction — le filtre par titre y
   * a écarté 100 % des offres de 18 sources au run du 2026-09-06 13:11 (« 26
   * hors secteur écartées », BROKEN). Seul un board généraliste le demande.
   */
  const isBoard = config.filterSector === true;
  let skippedOutOfSector = 0;
  for (const job of jobs) {
    // Group feeds carry the Maison per offer (LVMH: Sephora, Dior…); a
    // single-house feed falls back to the catalogue label.
    const employer = job.company || sourceDef.company;

    /**
     * Un JOBBOARD ou un cabinet publie tous les secteurs : Michael Page rendait
     * 3 334 offres dont 97,7 % hors Mode/Luxe/Beauté (audit A4, 2026-09-06) —
     * « Contrôleur Qualité Métallurgie » sur un jobboard de mode. Une source
     * employeur, elle, est dans le secteur par construction (voir ci-dessous).
     */
    if (isBoard && !classifySector({ company: employer, title: job.title }).inScope) {
      skippedOutOfSector++;
      continue;
    }

    /**
     * NO sector filter and NO France filter here — keep everything, filter on
     * the web.
     *
     * A catalogue feed IS in the vertical by construction, and re-classifying
     * each offer against the reference list silently dropped Maisons the list
     * does not name — Cheval Blanc's 117 offers would have gone to the bin for
     * not being a CSV row. France likewise becomes a stored flag the site
     * filters on, not a reason to discard: an offer thrown away here cannot be
     * un-thrown when the product wants an international view.
     */
    stats.inSector++;
    if (isFranceJob(job.country, job.location)) stats.france++;
    noteFieldCoverage(stats, job);

    try {
      // The catalogue feed carries its real vendor ATS (WORKDAY, GREENHOUSE…).
      const result = await upsertDeduplicated(
        prisma,
        toCandidate(job, sourceDef, employer, type as AtsType),
      );
      if (result.outcome === 'CREATED') stats.created++;
      else if (result.outcome === 'MERGED') stats.merged++;
      else stats.updated++;
    } catch (error) {
      stats.errors++;
      // briefError, not the raw message: a Prisma failure prints the whole
      // job.create payload (~90 lines), which flooded the log stream past its
      // rate cap and dropped other errors we then never saw.
      if (stats.errors <= 3) console.error(`[ingest] ${stats.source} write failed: ${briefError(error)}`);
    }
  }

  console.log(
    `[ingest] ${stats.source}: ${stats.france} FR / ${stats.inSector} in-sector / ${stats.fetched} fetched -> ` +
      `${stats.created} created, ${stats.merged} merged, ${stats.errors} errors` +
      (skippedOutOfSector > 0 ? ` (${skippedOutOfSector} hors secteur écartées)` : ''),
  );
  return stats;
}

/**
 * Did this source produce enough to justify purging its older-generation rows?
 *
 * A source that wrote nothing (returned an empty array, or every write failed)
 * must NOT trigger a purge: that is exactly the silent-zero failure mode, and
 * purging on it would delete the source's whole footprint. Only a source that
 * actually wrote offers this run has re-stamped them at the current version, so
 * only then is it safe to remove what it no longer lists.
 */
function producedOutput(stats: IngestStats): boolean {
  return stats.created + stats.merged + stats.updated > 0;
}

export type IngestOptions = {
  /**
   * Run a single source by its key (decision D6): each source becomes a short,
   * independent run, so one broken feed never takes the others down and a run
   * always finishes before the platform kills it. Absent = run every source.
   */
  only?: string;
  /**
   * A soft wall-clock deadline (epoch ms) for a slow crawl. The giants —
   * FashionJobs behind Cloudflare, Decathlon at crawl-delay 10s — cannot finish
   * inside the orchestrator's hard timeout AND cannot be sped up without
   * breaking robots.txt. So they stop THEMSELVES a little before it, keeping
   * every page already fetched (the listing is date-sorted and the database
   * accumulates across runs) — a graceful "continue next run" instead of the
   * hard timeout that discards the in-flight work.
   */
  deadlineMs?: number;
  /**
   * Leave geocoding to the caller. The orchestrator runs sources in parallel
   * and the CLI geocodes once at the end; a pass after every source would
   * look up the same cities several times at once.
   */
  skipGeocode?: boolean;
};

export async function runIngest(
  prisma: PrismaClient,
  options: IngestOptions = {},
): Promise<IngestStats[]> {
  // The catalogue now lives in the Source table (DEC-3); one read serves both
  // the sitemap and the API phases. Refuses to run on an unseeded base.
  const catalog = await loadActiveSources(prisma);

  const results: IngestStats[] = [];

  /**
   * Geocode incrementally, not only at the very end of the run.
   *
   * The map plots nothing without coordinates, and geocoding used to run
   * after ALL sources — on a multi-hour run that was killed by a redeploy,
   * it never ran at all, so production showed OSM tiles with zero markers.
   * A pass after each source keeps the map filling as offers land; the
   * GeoCache makes repeat passes nearly free.
   */
  const geocodeQuietly = async () => {
    if (options.skipGeocode) return;
    try {
      await runGeocode(prisma);
    } catch (error) {
      console.error('[ingest] geocode pass failed:', error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * Purge this source's older-generation rows — but ONLY if the run earned the
   * right to attest absence.
   *
   * Historiquement la seule garde était « la source a-t-elle écrit quelque
   * chose ? » (`producedOutput`), qui couvre le zéro silencieux mais PAS le run
   * partiel : `lagardere-travel-retail` écrivait 20 offres en en déclarant 109,
   * franchissait la garde, et la purge supprimait les 89 autres. La règle du
   * 2026-09-08 (D51) tranche : seul un run complet et fiable peut faire
   * disparaître ce qu'il n'a pas revu.
   */
  const purgeQuietly = async (stats: IngestStats) => {
    if (!producedOutput(stats)) return;
    if (!isTrustedForAttestation({
      status: 'OK', // l'échec franc n'arrive jamais ici (il est capturé plus haut)
      declaredTotal: stats.declaredTotal,
      fetched: stats.fetched,
      truncated: stats.truncated,
    })) {
      console.warn(
        `[ingest] ${stats.source}: purge REFUSÉE — run non fiable pour attester ` +
          `(${stats.fetched} collectées${stats.declaredTotal ? ` sur ${stats.declaredTotal} déclarées` : ''}` +
          `${stats.truncated ? ', tronqué' : ''}). Les offres non revues survivent.`,
      );
      return;
    }
    try {
      const purged = await purgeStaleForSource(prisma, stats.source, PIPELINE_VERSION);
      if (purged.jobsDeleted > 0 || purged.sourcesDetached > 0) {
        console.log(
          `[ingest] ${stats.source}: generation purge removed ${purged.jobsDeleted} stale jobs, ` +
            `detached ${purged.sourcesDetached} stale sources`,
        );
      }
    } catch (error) {
      console.error(`[ingest] ${stats.source} purge failed: ${briefError(error)}`);
    }
  };

  /**
   * API-backed catalogue feeds run FIRST — they are the bulk of the market and
   * the cheapest to obtain (one request per employer, not one per offer).
   *
   * Ordering matters: a full run of the heavy sitemap sources (L'Oréal 1725
   * pages, Decathlon 1240, Kering 1408, all fetched one page at a time) can
   * exceed the cron's time budget and be killed by the platform BEFORE the API
   * phase is ever reached — which is exactly why production held only a handful
   * of employers. Doing the API feeds first means the hundreds of Maisons they
   * expose are ingested even if the slow sitemap tail is cut short.
   *
   * Sequential on purpose: several portals serve many Maisons from one WAF, and
   * hammering one with parallel calls is what got the validation pass rate-limited.
   */
  const apiSources = catalog
    .filter((source) => KIND_TO_ATS[source.kind])
    .filter((source) => !options.only || source.key === options.only);
  if (apiSources.length > 0) {
    console.log(`[ingest] ${apiSources.length} API feeds: ${apiSources.map((s) => s.key).join(', ')}`);
  }

  for (const source of apiSources) {
    try {
      const stats = await ingestApiSource(prisma, source, options.deadlineMs);
      results.push(stats);
      await purgeQuietly(stats);
      await geocodeQuietly();
    } catch (error) {
      results.push({
        source: source.key,
        fetched: 0, inSector: 0, france: 0, created: 0, merged: 0, updated: 0, errors: 1,
        withDescription: 0, withDate: 0, withCountry: 0, withUrl: 0,
      });
      console.error(`[ingest] ${source.key} failed: ${briefError(error)}`);
    }
  }

  return results;
}
