import { reactivateJob } from '../pipeline/lifecycle.js';
import { lockOccupationTaxonomy, loadOccupationTaxonomy, type CompiledOccupationTaxonomy } from '@catwalks/db/occupations';
import { classifyOccupationContent, occupationState, recordOccupationObservation } from '../occupation/persist.js';
import { EmployerIdentityReviewRequired } from '../identity/errors.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import { lockEmployerCatalogue } from '../lib/writeLocks.js';
import { resolveEmployer, recordEmployerObservation, type EmployerResolution } from '../identity/resolve.js';
import { assertSourceRunning } from '../lib/sourceBudget.js';
import { lockCompanyRows, lockSourceWrites } from '../lib/writeLocks.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { selectCanonicalSource } from './canonical.js';
import { hasRequisitionConflict } from './postingIdentity.js';
import { blockingKey, isProbableDuplicate, SOURCE_PRIORITY, type CandidateJob } from './match.js';
import { classifySector, sectorForSource, type Sector } from '../normalize/sector.js';
import { findMaison } from '../normalize/maisons.js';
import { resolveCompany } from '../normalize/company.js';
import { countryFromLocation, normalizeCountry } from '../normalize/country.js';
import { resolveGeography } from '../normalize/geography.js';
import { countryIntegrityOf } from '../normalize/countryIntegrity.js';
import { cityFromLocation, displayCity } from '../normalize/location.js';
import { isFranceJob } from '../lib/france.js';
import { detectLanguage } from '../lib/language.js';
import { PIPELINE_VERSION } from '../pipeline/version.js';
import { TAXONOMY_VERSION } from '../normalize/taxonomy.js';
import { changedEvents, diffStructuralFields, structuralValuesOf, toNestedEventRow, type JobEventInput } from '../pipeline/jobEvents.js';


/** Classifier sectors map 1:1 onto the CompanySector enum. */
const SECTOR_TO_COMPANY_SECTOR: Record<Sector, string> = {
  FASHION: 'FASHION',
  LUXURY: 'LUXURY',
  BEAUTY: 'BEAUTY',
  JEWELRY_WATCHES: 'JEWELRY_WATCHES',
  RETAIL: 'RETAIL',
  SUPPLIER: 'SUPPLIER',
  MEDIA_AGENCY: 'MEDIA_AGENCY',
  RECRUITER: 'RECRUITER',
  OTHER: 'OTHER',
};

/**
 * Write-time deduplication — the guarantee that the database NEVER holds the same
 * opening twice, not even for a second.
 *
 * Deduplicating on a schedule would leave a window in which the front end shows
 * one job three times: Dior posts, LVMH republishes two hours later, and the
 * duplicate is visible until the next pass. So dedup is an INSERT rule, not a
 * periodic job:
 *
 *   1. compute the cluster key (resolved company + normalized city)
 *   2. compare against live jobs already in that cluster
 *   3. match  -> attach a JobSource, and promote the canonical URL if this
 *                source outranks the current one
 *      no match -> create the Job, with its first JobSource
 *
 * A separate weekly reconcile pass still earns its place, but only for
 * retroactive merges after an alias or synonym is added — never as the mechanism
 * that keeps the data clean.
 */

function tierRank(tier: string): number {
  const index = SOURCE_PRIORITY.indexOf(tier as (typeof SOURCE_PRIORITY)[number]);
  // An unknown tier must never outrank a known one.
  return index === -1 ? SOURCE_PRIORITY.length : index;
}

export type UpsertOutcome = 'CREATED' | 'MERGED' | 'UPDATED';

export type UpsertResult = {
  jobId: string;
  outcome: UpsertOutcome;
  /** True when this source took over the canonical apply URL. */
  promoted: boolean;
  occupationStatus: string;
  occupationReleaseId: string;
};

/**
 * Inserts one posting, merging it into an existing cluster when it is the same
 * opening. `companyId` is the resolved identity, not the raw source string.
 */
export async function upsertDeduplicated(
  prisma: PrismaClient,
  candidate: CandidateJob & { companyId: string },
  catalogue?: CompiledOccupationTaxonomy,
): Promise<UpsertResult> {
  const taxonomy = catalogue ?? await loadOccupationTaxonomy(prisma);
  for (let attempt = 0; ; attempt++) {
    assertSourceRunning();
    try {
      return await prisma.$transaction(async tx => {
        await lockEmployerCatalogue(tx);
        await lockSourceWrites(tx, candidate.sourceKey);
        const source = await tx.source.findUnique({ where: { key: candidate.sourceKey }, select: { status: true } });
        if (source?.status === 'RETIRED') throw new Error(`Source ${candidate.sourceKey} is RETIRED`);
        // Read identity/observation state only after serializing this upstream
        // posting; another writer may otherwise create it between lookup and lock.
        const entryKey = JSON.stringify(['entry', candidate.sourceKey, candidate.externalId]);
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${entryKey}, 0))`;
        const resolution = await resolveEmployer(tx, candidate);
        const resolved = resolution.company ? {
          ...candidate, company: resolution.company.name,
          companyId: resolution.company.canonicalKey,
          canonicalEmployerKey: resolution.company.canonicalKey,
        } : resolution.newKey ? {
          ...candidate, company: resolution.newName!, companyId: resolution.newKey,
          canonicalEmployerKey: resolution.newKey,
        } : candidate;
        // Source identity protects relocation/renaming; company serializes the
        // matching decision across independent feeds and cluster buckets.
        const companyKey = JSON.stringify(['company', resolved.companyId]);
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${companyKey}, 0))`;
        const target = resolution.company;
        const current = await tx.jobSource.findUnique({
          where: { sourceKey_externalId: { sourceKey: candidate.sourceKey, externalId: candidate.externalId } },
          select: { job: { select: { companyId: true } } },
        });
        await lockCompanyRows(tx, [target?.id, current?.job.companyId].filter((id): id is string => !!id));
        assertSourceRunning();
        const currentTaxonomy = await lockOccupationTaxonomy(tx, taxonomy);
        const result = await upsertInTransaction(tx, resolved, resolution, currentTaxonomy);
        assertSourceRunning(); // Throw inside the transaction so cancellation rolls writes back.
        return result;
      }, { maxWait: 10_000, timeout: 30_000 });
    } catch (error) {
      if (error instanceof EmployerIdentityReviewRequired) {
        // The failed canonical write rolled back. Archive the rejected evidence
        // separately, then surface the error so the run cannot attest absence.
        await prisma.$transaction(async tx => {
          if (candidate.raw != null) {
            const contentHash = createHash('sha256').update(JSON.stringify(candidate.raw)).digest('hex');
            await tx.sourceObservation.upsert({
              where: { sourceKey_externalId_contentHash: { sourceKey: candidate.sourceKey, externalId: candidate.externalId, contentHash } },
              create: { sourceKey: candidate.sourceKey, externalId: candidate.externalId, contentHash, raw: candidate.raw as Prisma.InputJsonValue, pipelineVersion: PIPELINE_VERSION }, update: {},
            });
          }
          await recordEmployerObservation(tx, candidate, null, {
            company: null, rule: 'REVIEW_REQUIRED', rawEmployerName: error.rawEmployerName,
            normalizedEmployerName: normalizedEmployerName(error.rawEmployerName),
          });
        });
        throw error;
      }
      // Retry the entire transaction, never query inside an aborted transaction.
      const code = error instanceof Error && 'code' in error ? error.code : undefined;
      if (attempt >= 2 || (code !== 'P2034' && code !== 'P2002')) throw error;
    }
  }
}

async function upsertInTransaction(
  prisma: Prisma.TransactionClient,
  candidate: CandidateJob & { companyId: string },
  resolution: EmployerResolution,
  catalogue: CompiledOccupationTaxonomy,
): Promise<UpsertResult> {
  const clusterKey = blockingKey(candidate);
  const now = new Date();
  if (candidate.raw !== undefined && candidate.raw !== null) {
    const payload = JSON.stringify(candidate.raw);
    const contentHash = createHash('sha256').update(payload).digest('hex');
    await prisma.sourceObservation.upsert({
      where: { sourceKey_externalId_contentHash: { sourceKey: candidate.sourceKey, externalId: candidate.externalId, contentHash } },
      create: { sourceKey: candidate.sourceKey, externalId: candidate.externalId, contentHash, raw: candidate.raw as Prisma.InputJsonValue, pipelineVersion: PIPELINE_VERSION, observedAt: now },
      update: {},
    });
  }

  // Job.companyId is a foreign key, so the Company row has to exist first —
  // otherwise every single write fails on a constraint violation and the run
  // ends with an empty database.
  // Classify once, at write time: the front end reads Company.kind, which
  // otherwise stays at its UNKNOWN default and every sector facet reads
  // "UNKNOWN" no matter how well the classifier works.
  // Pass the source's sector so an unrecognised employer from a sector-scoped
  // source (FashionJobs -> FASHION, LVMH -> LUXURY) inherits it instead of
  // falling to OTHER — this is what rescues the ~300 real Maisons the reference
  // list has never heard of.
  const verdict = classifySector({
    company: candidate.company,
    title: candidate.title,
    sourceSector: sectorForSource(candidate.sourceKey),
    // Toute offre ingérée vient d'une source promue au catalogue : son
    // appartenance au secteur est déjà établie (voir classifySector).
    fromCatalogue: Boolean(candidate.sourceKey),
  });
  const sector = (SECTOR_TO_COMPANY_SECTOR[verdict.sector] ?? 'OTHER') as never;

  // The reference list knows Sandro belongs to SMCP and Dior to LVMH. Storing
  // it lets a search for one brand reach offers a group portal published under
  // the parent's name — and gives the group its own filter.
  // Le référentiel d'abord, puis le groupe que porte l'alias (Cartier → Richemont) :
  // ~5 100 offres de flux de groupe n'avaient aucun groupe (audit A1).
  const parentGroup = findMaison(candidate.company)?.group || resolveCompany(candidate.company).group || null;

  const company = resolution.company ?? await prisma.company.upsert({
    where: { fashionjobsUrl: `resolved:${candidate.companyId}` },
    create: {
      name: candidate.company,
      canonicalKey: candidate.companyId,
      sector,
      // The unique key is the employer identity, not a FashionJobs URL: employers
      // reach us from their own sites too, and most never appear on that board.
      fashionjobsUrl: `resolved:${candidate.companyId}`,
      parentGroup,
      lastSeenAt: now,
      // The Maison's domain (its logo), when this source names it: the
      // catalogue's careers host, never a guess from the name.
      ...(candidate.companyDomain ? { domain: candidate.companyDomain, domainSource: 'source-careers' } : {}),
    },
    // Names and reviewed relationships change through an audited identity decision,
    // never as a side effect of an offer's spelling.
    update: { lastSeenAt: now },
    select: { id: true, domain: true },
  });

  if (resolution.company) await prisma.company.update({ where: { id: company.id }, data: { lastSeenAt: now } });
  await recordEmployerObservation(prisma, candidate, company.id, resolution);

  // A Company first created by a group feed (no domain) gets its domain the
  // day its own careers site re-attests it. Fill only when EMPTY: a domain
  // already set — by the catalogue, Wikidata or a hand — is never overwritten,
  // so a wrong write cannot churn a logo back and forth between two sources.
  if (candidate.companyDomain && !company.domain) {
    await prisma.company.updateMany({
      where: { id: company.id, domain: null },
      data: { domain: candidate.companyDomain, domainSource: 'source-careers' },
    });
  }

  /**
   * Identité EXACTE d'abord : la même source qui re-parle de la même offre
   * (sourceKey + externalId) — le cas de loin le plus fréquent, indexé, et
   * valable que l'offre soit active ou fermée.
   *
   * Audit A2 (2026-09-06) : sans ce chemin, une offre dont la clé de cluster
   * gravée ne correspondait plus à la clé recalculée (4 906 offres) ratait la
   * recherche de cluster, tombait dans la récupération P2002 qui touchait le
   * Job mais jamais la JobSource — 1 855 offres vivantes avec une JobSource
   * inactive, fermées (410) par le refresh puis ré-ouvertes par l'ingest
   * suivant, tous les jours. Ici, Job ET JobSource sont ré-attestés, et la
   * clé de cluster est ré-écrite si elle a changé.
   */
  const ownEntry = await prisma.jobSource.findUnique({
    where: { sourceKey_externalId: { sourceKey: candidate.sourceKey, externalId: candidate.externalId } },
    select: { job: { include: { sources: true }, omit: { searchText: true } } },
  });
  if (ownEntry) {
    // An exact feed ID does not make a historically corrupted merge safe.
    // Fail the write/run attestation until a reviewed repair separates it.
    if (hasRequisitionConflict([candidate.url, ...ownEntry.job.sources.filter(s => s.isActive).map(s => s.url)])) {
      throw new Error(`REQUISITION_IDENTITY_CONFLICT job=${ownEntry.job.id}; reviewed separation required`);
    }
    return attachToExisting(prisma, catalogue, candidate, ownEntry.job, now, clusterKey, company.id);
  }

  // Only live jobs in the same cluster can absorb this posting. The cluster key
  // is indexed, so this stays a narrow lookup rather than a scan.
  const clusterJobs = await prisma.job.findMany({
    where: { companyId: company.id, clusterKey, isActive: true, sources: { none: { sourceKey: candidate.sourceKey } } },
    select: {
      id: true, title: true, countryCode: true, city: true, location: true, postedAt: true, url: true, opportunityType: true,
      sources: { select: { sourceKey: true, externalId: true, url: true, isActive: true } },
    },
    orderBy: [{ firstSeenAt: 'asc' }, { id: 'asc' }],
  });

  /**
   * One source never publishes one opening twice: a job that already carries a
   * JobSource from THIS source under a DIFFERENT id is a different opening,
   * whatever the titles score. This guard existed in match.ts but the old code
   * fed it the CANDIDATE's own sourceKey/externalId (`{...candidate}`), so it
   * could never fire at write time — three distinct "Sales Associate" ids at
   * the same boutique collapsed into one displayed offer (audit D-01). The
   * sources are already loaded; compare against the real ones.
   */
  const existing = clusterJobs.find((job) => {
    if (hasRequisitionConflict([candidate.url, ...job.sources.filter(s => s.isActive).map(s => s.url)])) return false;
    const sameSourceOtherId = job.sources.some(
      (source) =>
        source.sourceKey === candidate.sourceKey && source.externalId !== candidate.externalId,
    );
    if (sameSourceOtherId) return false;
    return isProbableDuplicate(candidate, {
      ...candidate,
      title: job.title,
      opportunityType: job.opportunityType ?? undefined,
      url: job.url,
      // Use the stored posting's evidence, not the incoming country's/city's
      // values inherited by the spread above.
      country: job.countryCode ?? undefined,
      city: job.city ?? undefined,
      location: job.location ?? undefined,
      postedAt: job.postedAt ?? undefined,
    });
  });

  if (!existing) return createJob(prisma, catalogue, candidate, company.id, clusterKey, now);

  const matched = await prisma.job.findUniqueOrThrow({ where: { id: existing.id }, include: { sources: true }, omit: { searchText: true } });
  return attachToExisting(prisma, catalogue, candidate, matched, now, clusterKey, company.id);
}

/** Complete projection of one authoritative observation; shared by creation and reviewed repairs. */
export function canonicalJobContent(candidate: CandidateJob, catalogue: CompiledOccupationTaxonomy) {
  const { countryCode: country, countryIntegrity } = countryWithProvenance(candidate);
  const clusterKey = blockingKey(candidate);
  const taxonomy = classifyOccupationContent(candidate,catalogue);
  return {
    externalId: candidate.externalId,
    source: candidate.atsType ?? 'GENERIC_JSONLD' as const,
    title: candidate.title,
    opportunityType: candidate.opportunityType ?? null,
    description: candidate.description ?? null,
    location: candidate.location ?? null,
    countryCode: country ?? null,
    /** La provenance du pays, PERSISTÉE — jusqu'ici calculée puis jetée (0 valeur sur 78 932 offres). */
    countryIntegrity,
    adminArea1: adminArea1Of(candidate, country) ?? null,
    isFrance: isFranceJob(country ?? candidate.country, candidate.location),
    city: cityOf(candidate) ?? null,
    postalCode: candidate.postalCode ?? null,
    latitude: candidate.latitude ?? null,
    longitude: candidate.longitude ?? null,
    rawContract: candidate.rawContract ?? null,
    rawWorkingTime: candidate.rawWorkingTime ?? null,
    employmentEvidence: candidate.employmentEvidence as Prisma.InputJsonValue | undefined,
    employmentTerm: candidate.employmentTerm ?? null,
    engagementType: candidate.engagementType ?? null,
    isSeasonal: candidate.isSeasonal ?? null,
    workTime: candidate.workTime ?? null,
    workplaceType: candidate.workplaceType ?? null,
    experienceYears: candidate.experienceYears ?? null,
    educationLevel: candidate.educationLevel ?? null,
    salaryMin: candidate.salaryMin ?? null,
    salaryMax: candidate.salaryMax ?? null,
    salaryCurrency: candidate.salaryCurrency ?? null,
    salaryPeriod: candidate.salaryPeriod ?? null,
    department: candidate.department ?? null,
    validThrough: candidate.validThrough ?? null,
    language: candidate.language ?? detectLanguage(candidate.description ?? candidate.title),
    url: candidate.url,
    postedAt: candidate.postedAt ?? null,
    clusterKey,
    canonicalTier: candidate.sourceTier,
    canonicalSourceKey: candidate.sourceKey,
    canonicalExternalId: candidate.externalId,
    fingerprint: `${clusterKey}|${candidate.title}`,
    pipelineVersion: PIPELINE_VERSION,
    ...taxonomy,
    programType: candidate.programType ?? taxonomy.programType,
    raw: candidate.raw == null ? Prisma.DbNull : candidate.raw as Prisma.InputJsonValue,
  };
}

async function createJob(
  prisma: Prisma.TransactionClient,
  catalogue: CompiledOccupationTaxonomy,
  candidate: CandidateJob & { companyId: string },
  companyId: string,
  _clusterKey: string,
  now: Date,
): Promise<UpsertResult> {
  const created = await prisma.job.create({
    data: {
      ...canonicalJobContent(candidate,catalogue),
      companyId,
      lastSeenAt: now,
      sources: { create: {
        sourceKey: candidate.sourceKey, sourceTier: candidate.sourceTier,
        externalId: candidate.externalId, url: candidate.url, title: candidate.title,
        postedAt: candidate.postedAt, lastSeenAt: now,
        raw: candidate.raw == null ? Prisma.DbNull : candidate.raw as Prisma.InputJsonValue,
      } },
      events: { create: { type: 'OPENED', at: now } },
    },
  });
  await recordOccupationObservation(prisma,created,null);
  return { jobId: created.id, outcome: 'CREATED', promoted: true, occupationStatus: created.occupationStatus, occupationReleaseId: created.occupationReleaseId! };
}

/**
 * Pays ISO du candidat : celui de la source, sinon celui que porte le lieu
 * (audit A1 : 14 074 offres sans pays).
 *
 * `resolveGeography` est consulté AVANT `countryFromLocation` parce qu'il porte
 * la garde de collision : « Nashville, TN » y devient US/Tennessee, mais
 * « Berlin, DE » reste allemande. `countryFromLocation`, qui lit les segments à
 * l'envers sans cette garde, produisait 567 offres berlinoises au Delaware
 * (audit du 2026-09-08).
 */
function countryOf(candidate: CandidateJob): string | undefined {
  return countryWithProvenance(candidate).countryCode;
}

/**
 * Le pays retenu ET la preuve qui l'a produit, résolus ENSEMBLE.
 *
 * Les deux ne peuvent pas être calculés séparément : `countryOf` retient d'abord `normalizeCountry(country)`,
 * qui peut différer de ce que `resolveGeography` aurait choisi. Un verdict dérivé indépendamment décrirait
 * alors un pays qui n'est pas celui qu'on écrit — une preuve qui ne porte pas sur la valeur stockée n'est pas
 * une preuve. Le verdict n'est donc émis que lorsque le pays retenu est bien celui que la provenance établit.
 */
function countryWithProvenance(candidate: CandidateJob): {
  countryCode: string | undefined;
  countryIntegrity: string | null;
} {
  const geo = resolveGeography({
    rawCountry: candidate.country,
    location: candidate.location,
    city: candidate.city,
  });
  const countryCode = retainedCountryOf(candidate, geo.countryCode);
  // La preuve ne vaut que pour le pays effectivement retenu.
  const countryIntegrity = countryCode && countryCode === geo.countryCode
    ? countryIntegrityOf(geo, candidate.country)
    : null;
  return { countryCode, countryIntegrity };
}

function retainedCountryOf(candidate: CandidateJob, resolved: string | undefined): string | undefined {
  return (
    normalizeCountry(candidate.country) ??
    resolved ??
    countryFromLocation(candidate.location) ??
    // Un lieu que les signaux français reconnaissent (code postal, département,
    // région) sans pays nommé est en France : 440 offres actives « Paris (75) »
    // portaient isFrance sans pays (audit I-1, 2026-09-06).
    (isFranceJob(undefined, candidate.location) ? 'FR' : undefined)
  );
}

/**
 * La subdivision administrative, lue par la même chaîne que le pays.
 *
 * `legacyCountry` reçoit le pays que `countryOf` vient d'établir : sans lui,
 * « Success, WA » (Western Australia) redeviendrait « Washington » à chaque
 * ré-attestation, et le backfill et l'ingest divergeraient — l'invariant
 * `ingest == replay` l'interdit.
 */
function adminArea1Of(candidate: CandidateJob, country: string | undefined): string | undefined {
  return resolveGeography({
    rawCountry: candidate.country,
    location: candidate.location,
    city: candidate.city,
    legacyCountry: country,
  }).adminArea1;
}

/** Ville affichable — jamais un pays ou un code pays (« Ch », « Germany » : ~800 « villes », audit A1). */
function cityOf(candidate: CandidateJob): string | undefined {
  // La ville de l'adaptateur si elle est un lieu (location.ts rejette pays, états,
  // codes magasin, modes de travail), SINON celle que porte le lieu : +1 231
  // offres avec ville (lot 4). Pas de garde « ≠ pays » ici : elle effaçait
  // Singapour, Hong Kong, Luxembourg, Monaco (750 offres légitimes).
  return displayCity(candidate.city) ?? cityFromLocation(candidate.location);
}

type ExistingJob = Prisma.JobGetPayload<{ include: { sources: true }; omit: { searchText: true } }>;

/**
 * Ce qu'une ré-attestation ré-écrit sur une offre déjà en base.
 *
 * Mesuré en prod le 2026-09-06, après le premier run complet avec les
 * normalisations d'écriture (pays ISO, ville dérivée, titre de carte, texte
 * propre) : pays distincts 276 → 282, offres sans ville 37 845 → 37 770,
 * « Apply Now » 184 → 184. Les correctifs ne touchaient que la CRÉATION ; les
 * 56 000 lignes existantes étaient ré-attestées à chaque run sans jamais être
 * ré-écrites. Une offre que sa source re-liste porte les valeurs normalisées
 * de MAINTENANT : c'est l'auto-guérison de la base, une source à la fois.
 *
 * Règles : le pays et la ville ne sont ré-écrits que si le candidat en porte
 * un (jamais effacés) ; le titre et la description seulement quand c'est la
 * source actuellement canonique (`hasAuthority`) — une autre
 * source n'a pas autorité sur le texte du canonique — et la description
 * même si la correction est plus courte.
 */
type Reattestable = Pick<
  ExistingJob,
  | 'title' | 'description' | 'location' | 'city' | 'countryCode' | 'countryIntegrity' | 'adminArea1' | 'isFrance' | 'postedAt' | 'validThrough'
  | 'language' | 'employmentTerm' | 'workTime' | 'programType' | 'engagementType' | 'isSeasonal' | 'workplaceType' | 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'
> & { opportunityType?: ExistingJob['opportunityType'] };

/**
 * Champs simples : REMPLIS par n'importe quelle source quand ils sont vides,
 * RÉ-ÉCRITS seulement par la source actuellement canonique (`hasAuthority`).
 *
 * Audit A4 (2026-09-06) : date, langue, contrat, temps de travail, validité,
 * salaire n'étaient écrits qu'à la création — lignes nées avant le 04/09 :
 * 38 % sans date, 80 % sans langue ; après : 3 % / 2 %. LVMH : 4 131 dates
 * présentes dans le brut, 5 212 offres sans date.
 */
const SIMPLE_FIELDS = [
  'opportunityType', 'postedAt', 'validThrough', 'language', 'employmentTerm', 'workTime', 'programType', 'engagementType', 'isSeasonal', 'workplaceType',
] as const;
const SALARY_FIELDS = ['salaryMin', 'salaryMax', 'salaryCurrency', 'salaryPeriod'] as const;

export function reattestationFields(
  candidate: CandidateJob,
  existing: Reattestable,
  hasAuthority: boolean,
): Partial<Reattestable> {
  const out: Partial<Reattestable> = {};
  const { countryCode: country, countryIntegrity } = countryWithProvenance(candidate);
  const maySetGeography = hasAuthority || (!existing.countryCode && !existing.city && !existing.location);
  if (maySetGeography) {
    if (country && country !== existing.countryCode) out.countryCode = country;
    /**
     * La provenance suit le pays, et doit pouvoir être POSÉE **et EFFACÉE**.
     *
     * Même raison que pour `adminArea1` : une source qui cesse de publier son champ pays ne doit pas laisser
     * derrière elle une preuve périmée qui continuerait d'autoriser le balisage. Sans le chemin d'effacement,
     * le verdict ne serait qu'un acquis de backfill — donc temporaire, et faux dès la régression suivante.
     *
     * On n'écrit QUE lorsque le candidat porte une géographie exploitable : une source muette ne détruit pas
     * ce qu'une autre a établi.
     */
    if ((candidate.country || candidate.location) && countryIntegrity !== (existing.countryIntegrity ?? null)) {
      out.countryIntegrity = countryIntegrity;
    }
    if (country) {
      const isFrance = isFranceJob(country, candidate.location);
      if (isFrance !== existing.isFrance) out.isFrance = isFrance;
    }
    /**
     * `adminArea1` est DÉRIVÉ, comme le pays — il n'existe pas sur le candidat.
     * Il doit pouvoir être POSÉ **et EFFACÉ** : une offre australienne étiquetée
     * « Washington » par l'ancienne chaîne (703 cas mesurés le 2026-09-08) ne se
     * répare que si la ré-attestation sait écrire `null`. Sans ce chemin, chaque
     * correctif de géographie n'existerait qu'en backfill — donc temporaire.
     *
     * On n'efface QUE lorsque le candidat porte un lieu : une source qui n'en
     * publie pas ne doit pas détruire ce qu'une autre a établi.
     */
    const admin = adminArea1Of(candidate, country);
    if (admin !== (existing.adminArea1 ?? undefined) && (admin || candidate.location)) {
      out.adminArea1 = admin ?? null;
    }
    const city = cityOf(candidate);
    if (city && city !== existing.city) out.city = city;
    if (candidate.location && (!existing.location || hasAuthority) && candidate.location !== existing.location) {
      out.location = candidate.location;
    }
  } else if (country && country === normalizeCountry(existing.countryCode) && country !== existing.countryCode) {
    out.countryCode = country; // spelling normalization, not a change of country
  }
  // isFrance is a projection of the retained canonical country, not another
  // independently inferred geography field. A country-less reobservation
  // (Tourcoing at Vestiaire Collective) must repair a stale filter flag while
  // preserving the established country and the authority of its source.
  const retainedCountry = normalizeCountry(out.countryCode ?? existing.countryCode);
  if (retainedCountry && existing.isFrance !== (retainedCountry === 'FR')) {
    out.isFrance = retainedCountry === 'FR';
  }
  for (const field of SIMPLE_FIELDS) {
    const value = candidate[field];
    if (value === undefined || value === null) continue;
    const current = existing[field];
    const same = current instanceof Date && value instanceof Date ? current.getTime() === value.getTime() : current === value;
    if ((current === null || hasAuthority) && !same) (out as Record<string, unknown>)[field] = value;
  }
  // A salary is one tuple: never combine an employer amount with a board's
  // currency, or preserve an old currency after an authoritative new amount.
  if (SALARY_FIELDS.some(field => candidate[field] !== undefined) &&
      (hasAuthority || SALARY_FIELDS.every(field => existing[field] === null))) {
    for (const field of SALARY_FIELDS) {
      const value = candidate[field] ?? null;
      if (value !== existing[field]) (out as Record<string, unknown>)[field] = value;
    }
  }
  if (hasAuthority) {
    if (candidate.title && candidate.title !== existing.title) out.title = candidate.title;
    if (candidate.description !== undefined && candidate.description !== existing.description) {
      out.description = candidate.description;
    }
  }
  return out;
}

async function attachToExisting(
  prisma: Prisma.TransactionClient,
  catalogue: CompiledOccupationTaxonomy,
  candidate: CandidateJob,
  existing: ExistingJob,
  now: Date,
  /** La clé de cluster d'AUJOURD'HUI : ré-écrite si elle diffère de celle gravée. */
  clusterKey?: string,
  /** La société résolue d'aujourd'hui : ré-écrite par la source de l'entrée (alias corrigé, « Logo », marque de groupe). */
  companyId?: string,
): Promise<UpsertResult> {
  const alreadyKnown = existing.sources.some(
    (source) => source.sourceKey === candidate.sourceKey && source.externalId === candidate.externalId,
  );

  const observedSource = await prisma.jobSource.upsert({
    where: {
      sourceKey_externalId: {
        sourceKey: candidate.sourceKey,
        externalId: candidate.externalId,
      },
    },
    create: {
      jobId: existing.id,
      sourceKey: candidate.sourceKey,
      sourceTier: candidate.sourceTier,
      externalId: candidate.externalId,
      url: candidate.url,
      title: candidate.title,
      postedAt: candidate.postedAt,
      lastSeenAt: now,
      raw: candidate.raw as Prisma.InputJsonValue | undefined,
    },
    update: { url: candidate.url, title: candidate.title, postedAt: candidate.postedAt, sourceTier: candidate.sourceTier, lastSeenAt: now, isActive: true, raw: candidate.raw as Prisma.InputJsonValue | undefined },
  });

  const owner = selectCanonicalSource([
    ...existing.sources.filter(s => s.id !== observedSource.id), observedSource,
  ], existing)!;
  const hasAuthority = owner.id === observedSource.id;
  const promoted = hasAuthority && (
    owner.sourceKey !== existing.canonicalSourceKey || owner.externalId !== existing.canonicalExternalId
  ) && tierRank(owner.sourceTier) < tierRank(existing.canonicalTier ?? '');

  const reattested = reattestationFields(candidate, existing, hasAuthority);
  if(hasAuthority){
    const decisions=candidate.employmentEvidence?.decisions as Record<string,{origin?:string}>|undefined;
    for(const dimension of ['employmentTerm','workTime','programType','engagementType']){
      if(['CONFLICTING_EXPLICIT_EVIDENCE','AMBIGUOUS_STRUCTURED'].includes(decisions?.[dimension]?.origin??''))Object.assign(reattested,{[dimension]:null});
    }
  }

  const effective = { ...existing, ...reattested };
  const classification = classifyOccupationContent({
    title:effective.title,department:effective.department,description:effective.description,
    rawTitle:hasAuthority?(candidate.rawTitle??(effective.title===existing.title?existing.rawTitle:null)):existing.rawTitle,
    sourceKey:hasAuthority?candidate.sourceKey:existing.canonicalSourceKey??undefined,
    externalId:hasAuthority?candidate.externalId:existing.canonicalExternalId??undefined,
  },catalogue);
  const data = {
    lastSeenAt: now,
    isActive: true,
    // Every touch carries the current generation, so a merged offer is never
    // left below the version line and re-purged on the next run.
    pipelineVersion: PIPELINE_VERSION,
    // The normalized values of today reach the rows of yesterday.
    ...reattested,
    // La taxonomie suit la même règle d'auto-guérison : re-classée par la
    // source de l'entrée, ou dès que les règles ont changé de version.
    ...(hasAuthority || effective.department !== existing.department || existing.occupationReleaseId !== catalogue.manifest.id || existing.taxonomyVersion < TAXONOMY_VERSION
      ? {...occupationState(classification),taxonomyVersion:TAXONOMY_VERSION,isAiRelated:classification.isAiRelated,skills:classification.skills}
      : {}),
    // A cluster key that drifted (city normalized differently) is re-graved,
    // so the cluster lookup — and the weekly reconcile — find the row again.
    ...(hasAuthority && clusterKey && clusterKey !== existing.clusterKey ? { clusterKey } : {}),
    // 1 166 offres restaient sous une société périmée (audit A1) : l'alias ou
    // la marque corrigés ne les atteignaient jamais.
    ...(hasAuthority && companyId && companyId !== existing.companyId ? { companyId } : {}),
    url: owner.url,
    canonicalTier: owner.sourceTier,
    canonicalSourceKey: owner.sourceKey,
    canonicalExternalId: owner.externalId,
    ...(hasAuthority && candidate.employmentEvidence ? {rawContract:candidate.rawContract??null,rawWorkingTime:candidate.rawWorkingTime??null,employmentEvidence:candidate.employmentEvidence as Prisma.InputJsonValue}:{}),
    ...(hasAuthority && candidate.raw !== undefined ? { raw: candidate.raw as Prisma.InputJsonValue } : {}),
  };

  /**
   * L'histoire (D38) : un CHANGED par champ structurant qui change vraiment
   * (titre, ville, pays, société, métier — jamais la description, les dates
   * ou le salaire), et une RÉ-OUVERTURE quand une source re-liste une offre
   * que le refresh avait fermée. Avant, `isActive: true` était remis sans le
   * dire : la fermeture disparaissait de la base sans laisser de trace.
   */
  const reactivation = reactivateJob(existing);
  const events: JobEventInput[] = [
    ...(reactivation ? [{ jobId: existing.id, type: reactivation.type, at: now }] : []),
    // `structuralValuesOf` traduit les noms de COLONNE en noms d'ÉVÉNEMENT
    // (`countryCode` → `country`) : sans lui, un changement de pays cesse
    // silencieusement d'être tracé.
    ...changedEvents(existing.id, diffStructuralFields(structuralValuesOf(existing), structuralValuesOf(data)), now),
  ];

  // Une seule écriture : la ligne et ses événements dans la même requête
  // (createMany imbriqué), sans transaction interactive à tenir sous six
  // workers concurrents.
  const written = await prisma.job.update({
    where: { id: existing.id },
    data: {
      ...data,
      ...reactivation?.data,
      ...(events.length ? { events: { createMany: { data: events.map(toNestedEventRow) } } } : {}),
    },
  });

  await recordOccupationObservation(prisma,written,existing);
  return {
    jobId: existing.id,
    outcome: alreadyKnown ? 'UPDATED' : 'MERGED',
    promoted,
    occupationStatus: written.occupationStatus,
    occupationReleaseId: written.occupationReleaseId!,
  };
}
