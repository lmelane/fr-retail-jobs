import { maintainReviewedSectors } from '../sectors/qualify.js';
import { assertPipelineRunning } from '../lib/pipelinePause.js';
import { KIND_TO_ATS } from '../ats/catalogKinds.js';
import { splitRejectedRows } from './rejectedRows.js';
import { readEnumeration, type EnumerationReading } from './enumerationReading.js';
import { FULL_RUN_MARKER } from './fullRunMarker.js';
import { loadOccupationTaxonomy, type CompiledOccupationTaxonomy } from '@catwalks/db/occupations';
import { availableSourceWhere } from '@catwalks/db/availability';
import { log } from '../observability/logger.js';
import { archivePublicationHold } from './publicationHold.js';
import { publicationDisposition } from './publicationDisposition.js';
import { applyScopeExclusion, loadScopeExclusions } from './scopeDecisions.js';
import { assertSourceRunning } from '../lib/sourceBudget.js';
import type { PrismaClient, AtsType } from '@prisma/client';
import type { SourceTier } from '@catwalks/db/publications';
import { certifiedPortalScope } from '../connectors/sourceIdentity.js';
import { employerFromCertifiedScope } from '../identity/portalEmployer.js';
import { loadActiveSources, type RuntimeSource } from '../connectors/sourceStore.js';
import { classifySector } from '../normalize/sector.js';
import { resolveCompany } from '../normalize/company.js';
import { domainFromEmployerSources } from '../normalize/companyDomain.js';
import { resolveCanonicalDimensions, type TrustContext } from '../trust/resolve.js';
import { loadTrust } from '../trust/persist.js';
import { isFranceJob } from '../lib/france.js';
import { htmlToPlainText } from '../lib/html.js';
import { cleanTitle, cleanPlace, plausiblePostedAt, briefError } from '../lib/normalize.js';
import { effectiveSourceConfig } from '../connectors/sourceConfig.js';
import { upsertDeduplicated } from '../dedup/upsert.js';
import type { CandidateJob } from '../dedup/match.js';
import type { NormalizedJob } from '../types.js';
import { runGeocode } from './geocodeJobs.js';
import { fetchAtsJobs } from '../ats/index.js';
import { captureExtraction } from '../capture/batch.js';
import { adoptQualificationCapture } from '../capture/adoption.js';
import { incrementalPassActive, withIncrementalReading } from '../lib/incrementalReading.js';
import { knownPostings, reconfirmListed } from './knownPostings.js';
import { recordIngestionCompletion, type OutputFate } from '../capture/completion.js';
import { validateCapturedSource } from '../connectors/sourceValidation.js';
import { SourceAdmissionGateError } from '../connectors/sourceAdmission.js';
import { requireCurrentCaptureRevision } from '../connectors/sourceRevision.js';
import { lockSourceWrites, SOURCE_WRITE_TRANSACTION } from '../lib/writeLocks.js';
import { addIssue, IDENTITY_NEW_ENTRY, ingestionIssue, type IngestionIssue } from '../lib/ingestionIssue.js';
import { collectionEmployerLabels, PublisherFollowDeferred, publisherFollowBound, type PublisherFollowMode } from '../identity/publisherFollow.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import { EmployerIdentityReviewRequired } from '../identity/errors.js';
import { refusalOf, syncIdentityQueue, type IdentityQueueSync, type IdentityRefusal } from '../identity/reviewQueue.js';

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
  complete?: boolean;
  /**
   * `complete: false` lu par le RUN (D-453 §1) : NOT_PROVEN quand aucun fait observé ne contredit la fin du
   * parcours, REFUTED sinon (`enumerationReading.ts`). Les deux restent bloquants ; seule l'étiquette change.
   */
  enumerationReading?: EnumerationReading;
  /** Les faits observés qui réfutent l'énumération, nommés et bornés, pour la note de santé. */
  enumerationRefutedBy?: string[];
  /** NON PROUVÉE par la limite de sa famille (`STRUCTURAL_LIMIT_MARKERS`, D-520) : le marqueur que le lecteur a nommé. */
  enumerationUnprovable?: string;
  fetched: number;
  inSector: number;
  france: number;
  created: number;
  merged: number;
  updated: number;
  errors: number;
  issues?: IngestionIssue[];
  occupationStatuses?: Record<string, number>;
  /** Initial release; occupationReleases counts the actual decisions if activation occurs mid-run. */
  occupationReleaseId?: string;
  occupationReleases?: Record<string,number>;
  /** Bounded original cause, persisted in SourceRun rather than lost with logs. */
  errorNote?: string;
  /**
   * Posting write failures per bounded code (`fateReason`: `EmployerIdentityReviewRequired:PORTAL_OWNER_NOT_CERTIFIED`…),
   * the same code the sealed report keeps: the health note names the cause in plain words instead of a bare count.
   */
  writeFailures?: Record<string, number>;
  /**
   * Chronométrage PAR PHASE (P8) : `fetchMs` est le temps passé DEHORS (listing + détails), `upsertMs` le
   * temps cumulé passé à normaliser, dédupliquer et écrire. Leur somme est inférieure à la durée de la source
   * — le reste est l'orchestration —, et c'est leur RAPPORT qui dit où corriger : attendre le réseau et peiner
   * à écrire se soignent à des endroits opposés.
   */
  fetchMs?: number;
  upsertMs?: number;
  /** Rows the adapter rejected with a reason (failures are also counted in `errors`; explained rejections are not). */
  rejected?: number;
  rejectedReasons?: Record<string, number>;
  held?: number;
  /**
   * Retenues SANS disposition de cycle de vie (`publicationDisposition`) : rien ne les ferme ni ne les retire. Ce n'est
   * pas « à instruire » au sens du RUN : une retenue sur preuve de la source peut n'avoir aucune disposition
   * (employeur absent Workday) et ne pas bloquer ; seule `retentionClass` dit ce qui bloque (D-453 §1, D-456).
   */
  heldUnresolved?: number;
  /** Retained postings per hold reason: the health pass tells a native-evidence retention (D-453 §1) from the rest. */
  heldReasons?: Record<string, number>;
  /**
   * Per hold reason, the retained postings that stay online from an EARLIER collection once this RUN has archived
   * its holds (usable representation, offer active and not merged). Measured once per source; absent when nothing
   * was held or when the source failed before counting.
   */
  heldOnline?: Record<string, number>;
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
  /** The admitted, sealed collection this run published from, and its immutable end-of-ingestion report. */
  captureBatchId?: string;
  completionReportHash?: string;
  /** D-517 : une lecture incrémentale — `fetched` ne compte que le neuf ; `knownSkipped`, les publications connues laissées de côté. */
  incremental?: { knownSkipped: number; reconfirmed?: number; released?: number };
  /**
   * D-520 : la file de revue d'identité après cette collecte (`identity/reviewQueue.ts`) — entrées ouvertes de la source,
   * ouvertes, escaladées et résolues par elle, offres retenues. Absente quand la collecte n'est pas allée au bout.
   */
  identityReview?: IdentityQueueSync;
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

/**
 * The employer label a posting carries into identity resolution: the native name the page gives, else the company the
 * feed or catalogue supplies. One definition for `toCandidate` and for the collection index of D-506 §3.
 */
export function postingEmployerLabel(job: Pick<NormalizedJob, 'employerEvidence'>, companyName: string): string {
  return job.employerEvidence?.rawName ?? companyName;
}

export function toCandidate(
  job: NormalizedJob,
  source: SourceDef,
  companyName: string,
  atsType: AtsType,
  /**
   * Les verdicts de confiance, chargés UNE fois par run et résolus en mémoire :
   * une requête par offre serait un N+1 masqué sur 71 000 lignes. Une map vide
   * = comportement par défaut, jamais un échec d'ingest.
   */
  trust: TrustContext = new Map(),
): CandidateJob & { companyId: string } {
  if (job.publicationHold) throw new Error(`Posting is held: ${job.publicationHold}`);
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
   * LES CINQ DIMENSIONS D'EMPLOI — décidées par la chaîne COMMUNE.
   *
   * `resolveCanonicalDimensions` est la même fonction qu'utilisent le replay
   * offline, le dry-run et les tests : il n'existe pas de seconde
   * implémentation de la priorité. À preuves identiques et version de trust
   * identique, l'ingest et le replay produisent la même valeur canonique —
   * sinon le prochain run réintroduirait ce que le backfill vient de corriger.
   */
  const employment = resolveCanonicalDimensions(
    {
      sourceKey: source.key,
      title: job.title,
      description,
      contract: job.contract,
      workingTime: job.workingTime,
      raw: job.raw,
    },
    trust,
  );

  return {
    ...job,
    // Titre nettoyé (entités, espaces parasites : 2 400 offres, audit A1) ; lieu et
    // ville sans balise (« /a> » sur 71 offres L'Oréal) ; date de publication
    // plausible. Source facts are read once at the shared write boundary.
    rawTitle: job.title,
    rawContract: job.contract,
    rawWorkingTime: job.workingTime,
    employmentEvidence: JSON.parse(JSON.stringify({version:'employment-paths-20260909-v2',sourceKey:source.key,input:{contract:job.contract??null,workingTime:job.workingTime??null,title:job.title},decisions:employment.decisions})),
    title: cleanTitle(job.title) ?? job.title,
    location: cleanPlace(job.location),
    city: cleanPlace(job.city),
    postedAt: plausiblePostedAt(job.postedAt),
    description,
    // Le rythme suit exactement le même chemin que le mode de travail : résolu
    // dans `resolveCanonicalDimensions`, porté ici, écrit par `upsert`.
    workSchedule: employment.workSchedule,
    rawSchedule: employment.rawSchedule,
    // Chaque dimension reste VIDE quand la source ne la dit pas : l'absence
    // d'information est un vide, pas une valeur. (L'ancien « UNKNOWN » stocké
    // était truthy, et l'écran affichait « Contrat : UNKNOWN » sur chaque offre
    // dont la source omettait le champ.)
    employmentTerm: employment.employmentTerm,
    workTime: employment.workTime,
    programType: employment.programType,
    engagementType: employment.engagementType,
    isSeasonal: employment.isSeasonal,
    // This spelling key is only a lookup hint. The identity resolver decides
    // the stored employer from native labels or explicit reviewed relationships;
    // it preserves unknown native names instead of stripping their legal form.
    ...(() => {
      const identity = resolveCompany(companyName);
      return {
        rawEmployerName: postingEmployerLabel(job, companyName),
        employerLabelOrigin: job.employerEvidence ? `${job.employerEvidence.path}:${job.employerEvidence.rule}` : job.company ? 'ADAPTER_COMPANY' : 'SOURCE_CATALOGUE_LABEL',
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
export { KIND_TO_ATS } from '../ats/catalogKinds.js';


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
  /** Verdicts chargés une fois par run — voir `toCandidate`. */
  trust: TrustContext = new Map(),
  catalogue?: CompiledOccupationTaxonomy,
  /** La capture de qualification que ce tour vient de valider : adoptée si elle remplit toutes les conditions (lecture unique). */
  adoptCaptureId?: string,
  adoptCaptureRunId?: string | null,
): Promise<IngestStats> {
  const stats: IngestStats = {
    source: source.key,
    fetched: 0, inSector: 0, france: 0, created: 0, merged: 0, updated: 0, errors: 0,
    withDescription: 0, withDate: 0, withCountry: 0, withUrl: 0,
  };

  const type = KIND_TO_ATS[source.kind];
  if (!type) {
    await log.error('source.adapter_missing', `[ingest] ${source.maison}: no adapter for kind "${source.kind}"`);
    stats.errors = 1;
    return stats;
  }

  const config = effectiveSourceConfig(source.config);

  const occupationTaxonomy = catalogue ?? await loadOccupationTaxonomy(prisma);
  stats.occupationReleaseId = occupationTaxonomy.manifest.id;
  stats.occupationStatuses = {};
  stats.occupationReleases = {};
  /**
   * PHASE 1 — la COLLECTE (réseau) : listing + détails, tout ce que l'adaptateur va chercher dehors.
   * Chronométrée séparément de l'écriture parce que la question de P8 — où passe le temps — n'a pas de réponse
   * sur un total : un pipeline qui attend le réseau et un pipeline qui peine à écrire se corrigent à des
   * endroits opposés, et les confondre enverrait optimiser la mauvaise moitié.
   */
  const fetchStartedAt = Date.now();
  /**
   * LECTURE UNIQUE (lecture D-492 de D-516 §1) : la capture que la qualification de ce tour vient de valider est publiée
   * telle quelle, rejouée hors réseau, au lieu d'une seconde lecture du site — à ses conditions (`capture/adoption.ts`).
   * Refusée, la source relit le site sous sa décision d'accès, exactement comme avant.
   */
  const adoption = adoptCaptureId
    ? await adoptQualificationCapture(prisma, { key: source.key, revisionId: source.revisionId, config }, type as AtsType, adoptCaptureId,
      adoptCaptureRunId === undefined ? {} : { runId: adoptCaptureRunId })
    : null;
  const adopted = adoption && 'adopted' in adoption ? adoption.adopted : null;
  const collect = () => captureExtraction(
    prisma, stats.source, config, log.runId(), settings => fetchAtsJobs(type as never, settings), type, { revisionId: source.revisionId, requireActive: true });
  // D-517 : dans la passe de découverte, la collecte ne lit le détail que du neuf et ne rend que lui (`lib/incrementalReading.ts`).
  const extraction = adopted ?? (incrementalPassActive()
    ? await withIncrementalReading(await knownPostings(prisma, source.key), collect) : await collect());
  const { captureBatchId, jobs, declaredTotal, truncated, complete, enumeration, rejectedRows } = extraction;
  stats.fetchMs = Date.now() - fetchStartedAt;
  // An adopted capture keeps its own validation, the current one: the publication gate below checks it is still so.
  if (!adopted) {
    const validation = await validateCapturedSource(prisma, captureBatchId);
    if (validation.verdict !== 'VALIDATED') throw new SourceAdmissionGateError('CAPTURE_NOT_VALIDATED', 'Ingestion requires a qualified native result');
  }
  // Also checks empty feeds: no per-job writer will run for them.
  await prisma.$transaction(async tx => {
    await lockSourceWrites(tx, stats.source);
    await requireCurrentCaptureRevision(tx, await tx.captureBatch.findUniqueOrThrow({ where: { id: captureBatchId } }));
  }, SOURCE_WRITE_TRANSACTION);
  stats.captureBatchId = captureBatchId;
  // A bounded diagnostic envelope only. The enumeration proof itself lives in the
  // sealed manifest of the capture; the refresh reads it there, never from this log.
  await log.info('source.enumeration_observed', {
    sourceKey: stats.source, captureBatchId, complete: complete ?? null, declaredTotal: declaredTotal ?? null,
    fetched: jobs.length, truncated: truncated ?? null, termination: enumeration?.termination ?? null,
    canonicalContractDeclared: (enumeration?.pageEvidence?.length ?? 0) > 0 && enumeration!.pageEvidence!.every(page => Object.hasOwn(page, 'canonicalIds')),
    evidenceStatus: enumeration ? 'SEALED_IN_CAPTURE_MANIFEST' : 'ADAPTER_ENUMERATION_EVIDENCE_NOT_IMPLEMENTED',
  });
  if (rejectedRows?.length) {
    // Only rows the adapter could not READ count as collection errors; an explained
    // rejection (expired page still listed, row without a path) is a witness of the
    // enumeration and must not turn a complete source DEGRADED nor withhold its right
    // to attest absence (Alberto 6 postings / 74 expired pages, 2026-09-09).
    const split = splitRejectedRows(rejectedRows);
    stats.errors += split.failures.length;
    if (split.failures.length) addIssue(stats, { origin: 'UNKNOWN', code: 'REJECTED_NATIVE_ROWS', count: split.failures.length, captureBatchId });
    stats.rejected = rejectedRows.length;
    stats.rejectedReasons = split.reasons;
    await log.warn('source.rows_rejected', { sourceKey: stats.source, count: rejectedRows.length, failures: split.failures.length, reasons: split.reasons, rejectedRows });
  }
  stats.complete = complete;
  // Read from the sealed extraction itself, never from the log above: not proven ≠ refuted ≠ unknown (D-453 §1).
  const reading = readEnumeration(extraction);
  stats.enumerationReading = reading.enumerationReading;
  if (reading.enumerationRefutedBy) stats.enumerationRefutedBy = reading.enumerationRefutedBy;
  if (reading.enumerationUnprovable) stats.enumerationUnprovable = reading.enumerationUnprovable;
  stats.declaredTotal = declaredTotal;
  stats.truncated = truncated;
  if (extraction.incremental) stats.incremental = { knownSkipped: extraction.incremental.knownSkipped.length };
  // Audit r6 (F2, tranché par le CTO) : la passe relit la liste entière ; une offre connue qu'elle y voit (`knownSkipped`,
  // scellé et rejoué par la validation ci-dessus) est une preuve POSITIVE qu'elle est encore listée. Elle vaut
  // reconfirmation pour la disponibilité (R-143 §2 : « remise immédiatement si elle est confirmée de nouveau ») :
  // `lastSeenAt` avance à l'instant de la capture, et une retenue posée avant cet instant tombe, par la même règle que
  // la levée du RUN (`lastSeenAt >= availabilityHoldAt`). Une passe n'atteste toujours AUCUNE absence.
  if (extraction.incremental?.knownSkipped.length && !adopted) {
    Object.assign(stats.incremental!, await reconfirmListed(prisma, stats.source, captureBatchId, extraction.incremental.knownSkipped));
  }
  // Une lecture incrémentale ne rend que le neuf : sa « troncature » est voulue, et elle n'atteste rien (D-517).
  if (truncated && !extraction.incremental) {
    await log.error('source.listing_truncated', `[ingest] ${stats.source}: TRUNCATED — ${jobs.length} collected of ${declaredTotal} declared`);
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
  // Postings whose page names no employer may take the portal owner only on a
  // portal whose perimeter is certified SINGLE_BRAND for this configuration.
  const scope = jobs.some(j => j.publicationHold === 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL') ? await certifiedPortalScope(prisma, stats.source) : null;
  // Reviewed sector-perimeter exclusions (PostingScopeDecision OUT_OF_SCOPE): the posting is still
  // collected and archived, its publication is withheld and its representation withdrawn OUT_OF_SCOPE.
  const scopeExclusions = await loadScopeExclusions(prisma, stats.source);
  /**
   * LE DEVENIR DE CHAQUE SORTIE SCELLÉE. Les sorties sont ordonnées comme le manifeste (ordinal = position) ;
   * tout ce que la boucle ne publie pas est nommé — retenue, refus d'écriture, filtre sectoriel — puis scellé
   * dans le rapport de fin d'ingestion. Une interruption avant ce rapport laisse la collecte sans preuve
   * d'absence : elle ne peut alors rien faire disparaître.
   */
  const fates: OutputFate[] = [];
  // Every held posting, to count after the loop those an earlier collection still keeps online.
  const heldPostings: { externalId: string; reason: string }[] = [];
  // Group feeds carry the Maison per offer (LVMH: Sephora, Dior…); a single-house feed falls back to the catalogue label.
  const employerOf = (job: NormalizedJob) => job.company || sourceDef.company;
  const prepared = jobs.map(rawJob => applyScopeExclusion(employerFromCertifiedScope(rawJob, sourceDef.company, scope), scopeExclusions));
  /**
   * D-506 §3 — the proof is frozen before the first write: when this collection started, and which native label the
   * publisher gives each publishable posting in it. « The source already publishes B » then reads the same for every
   * posting, whatever the publisher's order and whatever the loop has already written. The postings that would follow
   * their publisher are written after the count of the whole source, with the other employer changes the publisher
   * made in this collection (refused: never seen in the source): the mass guard counts both.
   */
  const witnessesBefore = (await prisma.captureBatch.findUniqueOrThrow({ where: { id: captureBatchId }, select: { startedAt: true } })).startedAt;
  const publishedUnder = collectionEmployerLabels(prepared.filter(job => !job.publicationHold)
    .map(job => ({ externalId: job.externalId, label: normalizedEmployerName(postingEmployerLabel(job, employerOf(job))) })));
  const deferredFollows: { ordinal: number; job: NormalizedJob; employer: string }[] = [];
  let refusedEmployerChanges = 0;
  // D-520 : les offres retenues faute d'identité prouvée, pour la file de revue (une entrée par libellé et motif).
  const identityRefusals: IdentityRefusal[] = [];

  /**
   * PHASE 2 — l'ÉCRITURE d'une offre : normalisation, identité, déduplication, upsert. Cumulée offre par offre. Tout
   * refus est compté et scellé ici ; seul un report du suivi de l'éditeur (`DEFER`, D-506 §3) n'est ni une erreur ni
   * un devenir : l'offre est réécrite après la boucle.
   */
  const writePosting = async (ordinal: number, job: NormalizedJob, employer: string, publisherFollow: PublisherFollowMode): Promise<'WRITTEN' | 'FAILED' | 'DEFERRED'> => {
    try {
      // The catalogue feed carries its real vendor ATS (WORKDAY, GREENHOUSE…).
      const upsertStartedAt = Date.now();
      const result = await upsertDeduplicated(
        prisma,
        toCandidate(job, sourceDef, employer, type as AtsType, trust),
        occupationTaxonomy,
        { publisherFollow: { mode: publisherFollow, witnessesBefore, publishedUnder } },
      );
      stats.upsertMs = (stats.upsertMs ?? 0) + (Date.now() - upsertStartedAt);
      stats.occupationStatuses![result.occupationStatus] = (stats.occupationStatuses![result.occupationStatus] ?? 0) + 1;
      stats.occupationReleases![result.occupationReleaseId] = (stats.occupationReleases![result.occupationReleaseId] ?? 0) + 1;
      if (result.outcome === 'CREATED') stats.created++;
      else if (result.outcome === 'MERGED') stats.merged++;
      else stats.updated++;
      // The traceability of an employer change made without human review: who it left, who it joined, on which label.
      if (result.employerFollowed) {
        await log.info('employer.followed_publisher', { sourceKey: stats.source, connectorId: source.kind, jobId: job.externalId,
          catwalksJobId: result.jobId, ...result.employerFollowed, decision: 'D-506 §3' });
      }
      return 'WRITTEN';
    } catch (error) {
      log.assertHealthy();
      if (error instanceof PublisherFollowDeferred && publisherFollow === 'DEFER') return 'DEFERRED';
      if (publisherFollow === 'DEFER' && error instanceof EmployerIdentityReviewRequired && error.employerChange) refusedEmployerChanges++;
      if (error instanceof EmployerIdentityReviewRequired) identityRefusals.push(refusalOf(error));
      stats.errors++;
      addIssue(stats, { ...ingestionIssue(error), captureBatchId });
      /*
       * Le fate scellé ne garde qu'un CODE BORNÉ : les messages peuvent porter des URLs ou des
       * paramètres. La classe seule ne suffisait pourtant pas — `EmployerIdentityReviewRequired`
       * a six causes distinctes, et le rapport les rendait indiscernables (9 386 occurrences sous
       * un seul libellé le 2026-09-21, dont 27 sources bloquées par une simple configuration
       * absente). Les erreurs qui portent un `motif` de leur liste fermée l'exposent donc ici,
       * qualifié par la classe pour rester lisible sans ambiguïté.
       */
      fates.push({ ordinal, externalId: job.externalId, disposition: 'WRITE_FAILED', reason: fateReason(error) });
      // The same bounded code, counted so the health note names the cause (identity refusal motifs).
      const failure = fateReason(error);
      (stats.writeFailures ??= {})[failure] = (stats.writeFailures[failure] ?? 0) + 1;
      // Journal every failure, with its upstream posting ID. Console repeats
      // are aggregated centrally only AFTER durable recording.
      await log.error('job.write_failed', { sourceKey: stats.source, connectorId: source.kind, jobId: job.externalId, error });
      return 'FAILED';
    }
  };

  for (const [ordinal, job] of prepared.entries()) {
    assertSourceRunning();
    if (job.publicationHold) {
      stats.held = (stats.held ?? 0) + 1;
      stats.heldReasons = { ...stats.heldReasons, [job.publicationHold]: (stats.heldReasons?.[job.publicationHold] ?? 0) + 1 };
      fates.push({ ordinal, externalId: job.externalId, disposition: 'HELD', reason: job.publicationHold });
      if (!publicationDisposition(job.publicationHold)) {
        /**
         * UNE RETENUE EST UN DÉFAUT DE CETTE OFFRE-LÀ, PAS DE L'ÉNUMÉRATION DE LA SOURCE.
         *
         * Avant le 2026-09-11, cette branche posait `stats.complete = false`, ce qui retirait à la source
         * entière son droit d'attester l'absence. Mesuré en production : **187 sources portant 20 796
         * représentations vivantes** avaient lu tout ce qu'elles déclaraient et ne pouvaient plus fermer une
         * seule offre à cause de **766 pages défectueuses** — tapestry, 5 retenues sur 2 091 offres lues ;
         * vf-corporation, 695 sur 1 273 ; intersport-france, 63 sur 993.
         *
         * On a bien VU cette offre dans le listing : elle est comptée dans l'énumération. Ce qu'on n'a pas su
         * exploiter, c'est le contenu de sa page. Les deux questions sont distinctes (`pipeline/enumeration.ts`),
         * et l'offre retenue est suivie nommément dans `SourceObservation` — elle n'est ni publiée, ni perdue,
         * ni transformée en fermeture employeur.
         */
        stats.heldUnresolved = (stats.heldUnresolved ?? 0) + 1;
      }
      await archivePublicationHold(prisma, stats.source, job);
      heldPostings.push({ externalId: job.externalId, reason: job.publicationHold });
      await log.warn('job.publication_held', { sourceKey: stats.source, connectorId: source.kind, jobId: job.externalId, reason: job.publicationHold, evidence: 'SourceObservation' });
      continue;
    }
    const employer = employerOf(job);

    /**
     * Un JOBBOARD ou un cabinet publie tous les secteurs : Michael Page rendait
     * 3 334 offres dont 97,7 % hors Mode/Luxe/Beauté (audit A4, 2026-09-06) —
     * « Contrôleur Qualité Métallurgie » sur un jobboard de mode. Une source
     * employeur, elle, est dans le secteur par construction (voir ci-dessous).
     */
    if (isBoard && !classifySector({ company: employer, title: job.title }).inScope) {
      skippedOutOfSector++;
      fates.push({ ordinal, externalId: job.externalId, disposition: 'SKIPPED_OUT_OF_SECTOR', reason: 'SECTOR_FILTER' });
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

    // A posting that would follow its publisher to an employer its source already publishes waits for the count of
    // the whole source: nothing of it is written yet (D-506 §3, `identity/publisherFollow.ts`).
    if (await writePosting(ordinal, job, employer, 'DEFER') === 'DEFERRED') deferredFollows.push({ ordinal, job, employer });
  }

  /**
   * D-506 §3 — LA GARDE DE MASSE DU SUIVI DE L'ÉDITEUR. Le compte est complet : si plus de max(5, 5 % des offres
   * collectées) offres de la source changent d'employeur chez l'éditeur dans cette collecte (qu'elles puissent le suivre
   * ou non), AUCUNE ne le suit, toutes restent en revue humaine (`EMPLOYER_CHANGE_MASS` pour celles qui l'auraient
   * suivi). Chaque offre reportée est ré-écrite ici, sous son mode, avec toutes ses vérifications : une offre qui ne
   * remplit plus la règle retombe dans la revue ordinaire.
   */
  if (deferredFollows.length) {
    const bound = publisherFollowBound(stats.fetched);
    const employerChanges = deferredFollows.length + refusedEmployerChanges;
    const massGuarded = employerChanges > bound;
    if (massGuarded) {
      await log.warn('employer.follow_mass_guarded', { sourceKey: stats.source, connectorId: source.kind, postings: deferredFollows.length,
        employerChanges, collected: stats.fetched, bound, decision: 'D-506 §3' });
    }
    for (const deferred of deferredFollows) {
      assertSourceRunning();
      await writePosting(deferred.ordinal, deferred.job, deferred.employer, massGuarded ? 'MASS_GUARDED' : 'FOLLOW');
    }
  }

  /**
   * D-520 — LA FILE DE REVUE D'IDENTITÉ. Chaque offre refusée faute d'employeur prouvé est retenue (rien n'est écrit) et
   * rejoint une entrée de la file, avec la preuve qui manque et la question ; le refus reste compté (`writeFailures`,
   * issue `EmployerIdentityReviewRequired`) mais ne fait plus échouer le RUN (`isNonBlockingIssue`). Seule une collecte
   * complète d'un RUN ou d'une vérification résout les entrées que cette collecte ne refuse plus ; une passe
   * incrémentale ne lit que le neuf et ne résout rien.
   */
  stats.identityReview = await syncIdentityQueue(prisma, { sourceKey: stats.source, refusals: identityRefusals, captureBatchId,
    published: stats.created + stats.merged + stats.updated, incremental: incrementalPassActive(),
    complete: stats.complete === true && stats.truncated !== true && !incrementalPassActive() });
  // La garde de masse du RUN (`runSummary.ts`, IDENTITY_MASS) compte les sources qui ouvrent une entrée de file dans ce RUN.
  if (stats.identityReview.opened > 0) {
    const issue = stats.issues?.find(i => i.code === 'EmployerIdentityReviewRequired');
    if (issue) issue.detail = IDENTITY_NEW_ENTRY;
  }

  /**
   * A retention keeps THIS collection from publishing; it withdraws an earlier publication only when its reason
   * carries a disposition and the adapter dated the withdrawal (`publicationHold.ts`). Otherwise the earlier
   * representation stays online (`PRESENT_BUT_HELD`). The alert says how many, per reason, as the site sees them
   * (`availableSourceWhere`, offer active and not merged): one read per source, after every hold is archived.
   * Present as soon as a posting is held; `{}` = none online. Read only: nothing here withdraws anything. A failed
   * read fails nothing either: the count stays absent, and the alert says « maintien en ligne non mesuré ».
   */
  if (heldPostings.length) {
    try {
      const online = new Set((await prisma.jobSource.findMany({ where: { sourceKey: stats.source, ...availableSourceWhere(),
        externalId: { in: [...new Set(heldPostings.map(held => held.externalId))] }, job: { isActive: true, mergedIntoId: null } },
      select: { externalId: true } })).map(row => row.externalId));
      const heldOnline: Record<string, number> = {};
      for (const held of heldPostings) if (online.has(held.externalId)) heldOnline[held.reason] = (heldOnline[held.reason] ?? 0) + 1;
      stats.heldOnline = heldOnline;
    } catch (error) {
      log.assertHealthy();
      await log.warn('source.held_online_unmeasured', { sourceKey: stats.source, held: heldPostings.length, error });
    }
  }

  assertSourceRunning();
  // The immutable end of this admitted ingestion. A failure here is a run failure:
  // the offers already written are kept, but this collection proves no absence.
  const completion = await recordIngestionCompletion(prisma, captureBatchId, fates);
  stats.completionReportHash = completion.reportHash;
  await log.info('source.ingest_completed', `[ingest] ${stats.source}: ${stats.france} FR / ${stats.inSector} in-sector / ${stats.fetched} fetched -> ` +
      `${stats.created} created, ${stats.merged} merged, ${stats.errors} errors` +
      (skippedOutOfSector > 0 ? ` (${skippedOutOfSector} hors secteur écartées)` : ''),
    { captureBatchId, completionReportHash: completion.reportHash, published: completion.published, held: completion.held,
      writeFailed: completion.writeFailed, skipped: completion.skipped });
  assertSourceRunning();
  return stats;
}

export type IngestOptions = {
  /**
   * Run a single source by its key (decision D6): each source becomes a short,
   * independent run, so one broken feed never takes the others down and a run
   * always finishes before the platform kills it. Absent = run every source.
   */
  only?: string;
  /**
   * Leave geocoding to the caller. The orchestrator runs sources in parallel
   * and the CLI geocodes once at the end; a pass after every source would
   * look up the same cities several times at once.
   */
  skipGeocode?: boolean;
  /**
   * With `only`: the qualification capture this turn just validated for that source (`maintainSourceAccess`). The
   * ingestion adopts it instead of reading the site again when every condition holds (lecture unique).
   */
  adoptCaptureId?: string;
  /** The run that collected `adoptCaptureId` when a campaign parent handed it over; default: the current run. */
  adoptCaptureRunId?: string | null;
};

export async function runIngest(
  prisma: PrismaClient,
  options: IngestOptions = {},
): Promise<IngestStats[]> {
  assertPipelineRunning();
  // The catalogue now lives in the Source table (DEC-3); one read serves both
  // the sitemap and the API phases. Refuses to run on an unseeded base.
  const catalog = await loadActiveSources(prisma);

  /**
   * Les verdicts de confiance, lus UNE FOIS pour tout le run.
   *
   * Une panne de lecture interrompt la collecte : elle ne doit jamais rétablir
   * une priorité de champ qu’un verdict de confiance avait rejetée.
   */
  const occupationTaxonomy = await loadOccupationTaxonomy(prisma);
  const trust = await loadTrust(prisma); // Never restore rejected field priorities on a registry failure.

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
      await log.error('geocode.failed', { error });
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
    await log.info('ingest.sources_selected', `[ingest] ${apiSources.length} API feeds: ${apiSources.map((s) => s.key).join(', ')}`);
  }

  for (const source of apiSources) {
    try {
      assertSourceRunning();
      // No closure happens here: the refresh reads the sealed proof of this admitted
      // collection and decides absence under its own locks and manifest.
      const stats = await log.withContext({ sourceKey: source.key, connectorId: source.kind }, () => ingestApiSource(prisma, source, trust, occupationTaxonomy,
        options.only === source.key ? options.adoptCaptureId : undefined, options.only === source.key ? options.adoptCaptureRunId : undefined));
      results.push(stats);
      await geocodeQuietly();
    } catch (error) {
      log.assertHealthy();
      results.push({
        source: source.key,
        fetched: 0, inSector: 0, france: 0, created: 0, merged: 0, updated: 0, errors: 1,
        withDescription: 0, withDate: 0, withCountry: 0, withUrl: 0,
        errorNote: briefError(error),
        issues: [ingestionIssue(error)],
      });
      await log.error('source.ingest_failed', { sourceKey: source.key, connectorId: source.kind, error });
    }
  }

  // One bounded employer review pass for a normal run. Single-source debugging
  // never mutates unrelated employers; unknown identities simply abstain.
  if (!options.only) {
    assertPipelineRunning();
    // A complete collection of every source: the negative-proof guard may take its reference here (health.ts).
    await log.info(FULL_RUN_MARKER, await maintainReviewedSectors(prisma));
  }
  return results;
}

/**
 * Le code borné qui entre dans le rapport scellé.
 *
 * Une erreur qui porte un `motif` de sa liste fermée le rend visible, préfixé de sa classe pour
 * qu'un code ne soit jamais confondu avec un autre domaine d'erreur. Toute autre erreur garde son
 * seul nom de classe : un message peut porter une URL ou un paramètre, et le rapport est scellé.
 */
function fateReason(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  const motif = (error as { motif?: unknown }).motif;
  if (error.name && typeof motif === 'string' && /^[A-Z][A-Z0-9_]{3,48}$/.test(motif)) {
    return `${error.name}:${motif}`;
  }
  return error.name || 'UnknownError';
}
