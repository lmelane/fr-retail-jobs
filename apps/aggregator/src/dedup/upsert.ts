import { publicationPresentation, publicationJobPatch } from '../publication/presentation.js';
import { publicationJobContent } from '../publication/content.js';
import { readSourceFacts, projectSourceFacts } from '../facts/index.js';
import { deactivateJob, reactivateJob } from '../pipeline/lifecycle.js';
import { declaredExpiry } from '../normalize/expiry.js';
import { explicitlyListed } from '../pipeline/publicationDisposition.js';
import { lockOccupationTaxonomy, loadOccupationTaxonomy, type CompiledOccupationTaxonomy } from '@catwalks/db/occupations';
import { recordOccupationObservation } from '../occupation/persist.js';
import { EmployerIdentityReviewRequired } from '../identity/errors.js';
import { normalizedEmployerName } from '../normalize/employerName.js';
import { lockEmployerCatalogue } from '../lib/writeLocks.js';
import { resolveEmployer, recordEmployerObservation, type EmployerResolution } from '../identity/resolve.js';
import { assertSourceRunning } from '../lib/sourceBudget.js';
import { lockCompanyRows, lockSourceWrites } from '../lib/writeLocks.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import { selectApplySource, SOURCE_PRIORITY } from '@catwalks/db/publications';
import { hasRequisitionConflict } from './postingIdentity.js';
import { blockingKey, provenPublicationGroup, type CandidateJob } from './match.js';
import { archiveAdapterOutput } from '../capture/observations.js';
import { recordPublicationAttachment, reviewedPublicationGroup } from './decisions.js';
import { classifySector, sectorForSource, type Sector } from '../normalize/sector.js';
import { findMaison } from '../normalize/maisons.js';
import { resolveCompany } from '../normalize/company.js';
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

/** Native source identity is stable. Cross-source grouping requires an exact,
 * qualified application identity; every publication and observation survives. */

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
  await archiveAdapterOutput(prisma, candidate);
  const facts = readSourceFacts(candidate.atsType ?? 'GENERIC_JSONLD', candidate.raw);
  candidate = { ...candidate, ...projectSourceFacts(facts), sourceFacts: facts };
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
    const publications = ownEntry.job.sources.map(source => source.sourceKey === candidate.sourceKey && source.externalId === candidate.externalId
      ? { ...source, raw: candidate.raw, url: candidate.url } : source);
    if (publications.length > 1 && !provenPublicationGroup(publications) && !await reviewedPublicationGroup(prisma, ownEntry.job.id, publications)) {
      throw new Error(`PUBLICATION_GROUP_REVIEW_REQUIRED job=${ownEntry.job.id}; native identity evidence no longer agrees`);
    }
    return attachToExisting(prisma, catalogue, candidate, ownEntry.job, now, company.id);
  }

  // Only live jobs in the same cluster can absorb this posting. The cluster key
  // is indexed, so this stays a narrow lookup rather than a scan.
  const clusterJobs = await prisma.job.findMany({
    where: { companyId: company.id, clusterKey, isActive: true, sources: { none: { sourceKey: candidate.sourceKey } } },
    select: {
      id: true, opportunityType: true,
      sources: { select: { sourceKey: true, externalId: true, url: true, isActive: true, raw: true } },
    },
    orderBy: [{ firstSeenAt: 'asc' }, { id: 'asc' }],
  });

  const matches = clusterJobs.filter(job =>
    (!candidate.opportunityType || !job.opportunityType || candidate.opportunityType === job.opportunityType) &&
    provenPublicationGroup([candidate, ...job.sources]),
  );
  // Multiple presentation groups claiming one application need consolidation
  // with a reviewed plan; ingestion must not choose an arbitrary survivor.
  const existing = matches.length === 1 ? matches[0] : undefined;

  if (!existing) return createJob(prisma, catalogue, candidate, company.id, now);

  const matched = await prisma.job.findUniqueOrThrow({ where: { id: existing.id }, include: { sources: true }, omit: { searchText: true } });
  return attachToExisting(prisma, catalogue, candidate, matched, now, company.id);
}

async function createJob(
  prisma: Prisma.TransactionClient,
  catalogue: CompiledOccupationTaxonomy,
  candidate: CandidateJob & { companyId: string },
  companyId: string,
  now: Date,
): Promise<UpsertResult> {
  const expiry = declaredExpiry(candidate.atsType ?? 'GENERIC_JSONLD', candidate.raw);
  const expired = !!expiry?.expiresAt && expiry.expiresAt <= now;
  const content = publicationJobContent(candidate, catalogue);
  const presentation = publicationPresentation(candidate, content);
  const created = await prisma.job.create({
    data: {
      ...content,
      companyId,
      lastSeenAt: now,
      isActive: !expired,
      closedAt: expired ? now : null,
      sources: { create: {
        sourceKey: candidate.sourceKey, sourceTier: candidate.sourceTier,
        externalId: candidate.externalId, url: candidate.url, title: candidate.title,
        postedAt: candidate.postedAt, lastSeenAt: now,
        isActive: !expired,
        expiresAt: expiry?.expiresAt,
        expiryEvidence: expiry?.evidence,
        captureBatchId: candidate.captureBatchId, captureOutputId: candidate.captureOutputId,
        raw: candidate.raw == null ? Prisma.DbNull : candidate.raw as Prisma.InputJsonValue,
        sourceFacts: candidate.sourceFacts as unknown as Prisma.InputJsonValue, presentation,
      } },
      events: { create: { type: expired ? 'CLOSED' : 'OPENED', at: now } },
    },
  });
  await recordOccupationObservation(prisma,created,null);
  return { jobId: created.id, outcome: 'CREATED', promoted: true, occupationStatus: created.occupationStatus, occupationReleaseId: created.occupationReleaseId! };
}

type ExistingJob = Prisma.JobGetPayload<{ include: { sources: true }; omit: { searchText: true } }>;

async function attachToExisting(
  prisma: Prisma.TransactionClient,
  catalogue: CompiledOccupationTaxonomy,
  candidate: CandidateJob,
  existing: ExistingJob,
  now: Date,
  /** La société résolue d'aujourd'hui : ré-écrite par la source de l'entrée (alias corrigé, « Logo », marque de groupe). */
  companyId?: string,
): Promise<UpsertResult> {
  const alreadyKnown = existing.sources.some(
    (source) => source.sourceKey === candidate.sourceKey && source.externalId === candidate.externalId,
  );

  const expiry = declaredExpiry(candidate.atsType ?? 'GENERIC_JSONLD', candidate.raw);
  // A partial capture cannot erase a previously proven deadline.
  const prior = existing.sources.find(source => source.sourceKey === candidate.sourceKey && source.externalId === candidate.externalId);
  const expiresAt = expiry ? expiry.expiresAt : prior?.expiresAt;
  const available = !expiresAt || expiresAt > now;
  const expiryFields = expiry ? { expiresAt: expiry.expiresAt, expiryEvidence: expiry.evidence } : {};

  const observedContent = publicationJobContent(candidate, catalogue);
  const presentation = publicationPresentation(candidate, observedContent);
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
      isActive: available,
      ...expiryFields,
      raw: candidate.raw as Prisma.InputJsonValue | undefined,
      sourceFacts: candidate.sourceFacts as unknown as Prisma.InputJsonValue, presentation,
      captureBatchId: candidate.captureBatchId, captureOutputId: candidate.captureOutputId,
    },
    update: { url: candidate.url, title: candidate.title, postedAt: candidate.postedAt ?? null, sourceTier: candidate.sourceTier, lastSeenAt: now, isActive: available, ...expiryFields,
      sourceFacts: candidate.sourceFacts as unknown as Prisma.InputJsonValue, presentation,
      captureBatchId: candidate.captureBatchId ?? null, captureOutputId: candidate.captureOutputId ?? null,
      raw: candidate.raw == null ? Prisma.DbNull : candidate.raw as Prisma.InputJsonValue },
  });

  if (!alreadyKnown) await recordPublicationAttachment(prisma, observedSource, existing.sources, null, existing.id);

  const owner = selectApplySource([
    ...existing.sources.filter(s => s.id !== observedSource.id), observedSource,
  ], existing, now);
  const hasAuthority = owner?.id === observedSource.id;
  const promoted = hasAuthority && (
    owner.sourceKey !== existing.canonicalSourceKey || owner.externalId !== existing.canonicalExternalId
  ) && tierRank(owner.sourceTier) < tierRank(existing.canonicalTier ?? '');

  // Optional fields belong to the selected publication, including their absence.
  // A secondary source cannot fill a blank in someone else's observation.
  const content = owner ? publicationJobPatch(owner, catalogue) : {};
  const data = {
    lastSeenAt: now,
    ...content,
    ...(hasAuthority && companyId && companyId !== existing.companyId ? { companyId } : {}),
    ...(owner ? { url: owner.url, canonicalTier: owner.sourceTier,
      canonicalSourceKey: owner.sourceKey, canonicalExternalId: owner.externalId } : {}),
  };

  /**
   * L'histoire (D38) : un CHANGED par champ structurant qui change vraiment
   * (titre, ville, pays, société, métier — jamais la description, les dates
   * ou le salaire), et une RÉ-OUVERTURE quand une source re-liste une offre
   * que le refresh avait fermée. Avant, `isActive: true` était remis sans le
   * dire : la fermeture disparaissait de la base sans laisser de trace.
   */
  const canRelist = existing.withdrawalReason === 'SOURCE_UNLISTED' && hasAuthority &&
    prior && prior.sourceKey === existing.canonicalSourceKey && prior.externalId === existing.canonicalExternalId &&
    explicitlyListed(candidate.atsType, candidate.raw);
  const administrativeWithdrawal = existing.withdrawnAt && existing.withdrawalReason !== 'ATTESTATION_MISSING' && !canRelist;
  const reactivation = administrativeWithdrawal ? null : owner
    ? reactivateJob(existing) : deactivateJob(existing, { kind: 'CLOSED' }, now);
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
