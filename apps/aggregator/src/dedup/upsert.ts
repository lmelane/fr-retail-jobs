import type { PrismaClient } from '@prisma/client';
import { blockingKey, isProbableDuplicate, SOURCE_PRIORITY, type CandidateJob } from './match.js';
import { classifySector, type Sector } from '../normalize/sector.js';
import { findMaison } from '../normalize/maisons.js';
import { isFranceJob } from '../lib/france.js';
import { PIPELINE_VERSION } from '../pipeline/version.js';


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
};

/**
 * Inserts one posting, merging it into an existing cluster when it is the same
 * opening. `companyId` is the resolved identity, not the raw source string.
 */
export async function upsertDeduplicated(
  prisma: PrismaClient,
  candidate: CandidateJob & { companyId: string },
): Promise<UpsertResult> {
  const clusterKey = blockingKey(candidate);
  const now = new Date();

  // Job.companyId is a foreign key, so the Company row has to exist first —
  // otherwise every single write fails on a constraint violation and the run
  // ends with an empty database.
  // Classify once, at write time: the front end reads Company.kind, which
  // otherwise stays at its UNKNOWN default and every sector facet reads
  // "UNKNOWN" no matter how well the classifier works.
  const verdict = classifySector({ company: candidate.company, title: candidate.title });
  const sector = (SECTOR_TO_COMPANY_SECTOR[verdict.sector] ?? 'OTHER') as never;

  // The reference list knows Sandro belongs to SMCP and Dior to LVMH. Storing
  // it lets a search for one brand reach offers a group portal published under
  // the parent's name — and gives the group its own filter.
  const parentGroup = findMaison(candidate.company)?.group || null;

  const company = await prisma.company.upsert({
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
    },
    // Re-write the name on every update, not only on create: a Company created
    // before the "+N" strip (decision D11) shipped keeps its polluted name
    // forever otherwise ("Cartier +3", "IWC Schaffhausen +3"…), because the old
    // update left `name` untouched. candidate.company is already the resolved,
    // stripped display name, and it is identical for every offer of the same
    // companyId, so this is a stable self-heal — the 40 legacy rows clean up on
    // their next ingest.
    update: { name: candidate.company, sector, parentGroup, lastSeenAt: now },
    select: { id: true },
  });

  // Only live jobs in the same cluster can absorb this posting. The cluster key
  // is indexed, so this stays a narrow lookup rather than a scan.
  const clusterJobs = await prisma.job.findMany({
    where: { clusterKey, isActive: true },
    include: { sources: true },
  });

  const existing = clusterJobs.find((job) =>
    isProbableDuplicate(candidate, {
      ...candidate,
      title: job.title,
      location: job.location ?? undefined,
      postedAt: job.postedAt ?? undefined,
    }),
  );

  if (!existing) {
    try {
      return await createJob(prisma, candidate, company.id, clusterKey, now);
    } catch (error) {
      /**
       * The race this catches, seen live: six workers, two copies of the same
       * offer, both pass the cluster lookup before either has written, the
       * second create violates a unique key — 123 write errors on one Kering
       * run. The violation IS the answer: the job exists now, so fall through
       * and attach to it like any other duplicate.
       *
       * TWO unique keys can trip here, and the recovery must survive both:
       *   - Job(companyId, source, externalId): the same opening, same ATS.
       *   - JobSource(sourceKey, externalId): the same feed entry reached this
       *     job through a different cluster, and its source row already exists —
       *     possibly on a Job written with a DIFFERENT `source` (atsType), so the
       *     Job-key lookup below misses it. Looking up by the Job key alone then
       *     found no winner and re-threw, losing the offer (the real Kering bug).
       */
      const isUniqueViolation =
        error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002';
      if (!isUniqueViolation) throw error;

      // Try the Job unique key first (same opening, same ATS); if that misses,
      // the collision was on the JobSource key, so find the job that already
      // owns this (sourceKey, externalId). Either way we resolve a winning job
      // id — the offer attaches instead of being thrown away.
      const byJobKey = await prisma.job.findUnique({
        where: {
          companyId_source_externalId: {
            companyId: company.id,
            source: candidate.atsType ?? 'GENERIC_JSONLD',
            externalId: candidate.externalId,
          },
        },
        select: { id: true },
      });
      const bySourceKey = byJobKey
        ? null
        : await prisma.jobSource.findUnique({
            where: {
              sourceKey_externalId: {
                sourceKey: candidate.sourceKey,
                externalId: candidate.externalId,
              },
            },
            select: { jobId: true },
          });
      const winnerId = byJobKey?.id ?? bySourceKey?.jobId;
      if (!winnerId) throw error;

      await prisma.job.update({
        where: { id: winnerId },
        // Stamp the current generation on every touch, not just on create:
        // a row left at an older version is deleted by the next generation
        // purge, then recreated — churning its id and firstSeenAt on every run.
        // Refresh the url too, so an adapter URL fix reaches rows already stored
        // (same source -> same canonical URL, so this only corrects).
        data: {
          lastSeenAt: now,
          isActive: true,
          pipelineVersion: PIPELINE_VERSION,
          url: candidate.url,
        },
      });
      return { jobId: winnerId, outcome: 'UPDATED', promoted: false };
    }
  }

  return attachToExisting(prisma, candidate, existing, now);
}

async function createJob(
  prisma: PrismaClient,
  candidate: CandidateJob & { companyId: string },
  companyId: string,
  clusterKey: string,
  now: Date,
): Promise<UpsertResult> {
  const created = await prisma.job.create({
    data: {
        companyId,
        externalId: candidate.externalId,
        // The real ATS, not a hard-coded default: the unique key
        // (companyId, source, externalId) must separate two different sources
        // that happen to share an externalId for the same employer.
        source: candidate.atsType ?? 'GENERIC_JSONLD',
        title: candidate.title,
        location: candidate.location,
        country: candidate.country,
        // Stored as a FLAG, never used as a discard: the site defaults to the
        // French view and can widen later. This line was missing — every job
        // sat at the schema default `false`, and a front end filtering on
        // isFrance:true would have shown an empty board over a full database.
        isFrance: isFranceJob(candidate.country, candidate.location),
        contract: candidate.contract,
        // Rich fields the richer vendors publish. Absent means "this source does
        // not expose it", so they are written through rather than dropped.
        city: candidate.city,
        postalCode: candidate.postalCode,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        workingTime: candidate.workingTime,
        remote: candidate.remote,
        experienceYears: candidate.experienceYears,
        educationLevel: candidate.educationLevel,
        salaryMin: candidate.salaryMin,
        salaryMax: candidate.salaryMax,
        salaryCurrency: candidate.salaryCurrency,
        salaryPeriod: candidate.salaryPeriod,
        department: candidate.department,
        validThrough: candidate.validThrough,
        description: candidate.description,
        url: candidate.url,
        postedAt: candidate.postedAt,
        clusterKey,
        canonicalTier: candidate.sourceTier,
        fingerprint: `${clusterKey}|${candidate.title}`,
        pipelineVersion: PIPELINE_VERSION,
        lastSeenAt: now,
        /**
         * The untouched source payload. Nothing is discarded: the normalized
         * columns are the standard view, and this keeps every field a vendor
         * publishes — including ones no column exists for yet, which can then be
         * promoted later without re-fetching the whole market.
         */
        raw: candidate.raw as never,
        sources: {
          create: {
            sourceKey: candidate.sourceKey,
            sourceTier: candidate.sourceTier,
            externalId: candidate.externalId,
            url: candidate.url,
            title: candidate.title,
            postedAt: candidate.postedAt,
            lastSeenAt: now,
            // Per-source payload too: each source sees the posting differently.
            raw: candidate.raw as never,
          },
        },
      },
  });
  return { jobId: created.id, outcome: 'CREATED', promoted: true };
}

type ExistingJob = {
  id: string;
  url: string | null;
  canonicalTier: string | null;
  description: string | null;
  sources: { sourceKey: string; externalId: string }[];
};

async function attachToExisting(
  prisma: PrismaClient,
  candidate: CandidateJob,
  existing: ExistingJob,
  now: Date,
): Promise<UpsertResult> {
  const alreadyKnown = existing.sources.some(
    (source) => source.sourceKey === candidate.sourceKey && source.externalId === candidate.externalId,
  );

  await prisma.jobSource.upsert({
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
    },
    update: { url: candidate.url, title: candidate.title, lastSeenAt: now, isActive: true },
  });

  // A better-ranked source takes over the canonical apply URL: a candidate should
  // always be sent to the employer when the employer is publishing the role.
  const promoted = tierRank(candidate.sourceTier) < tierRank(existing.canonicalTier ?? '');

  // Refresh the canonical URL WITHOUT promotion only when the writer is the SAME
  // OR HIGHER tier as the current owner AND the URL actually changed. This lets
  // an adapter fix (a corrected URL format from the same/higher-tier source)
  // reach rows already in the base, without letting a LOWER-tier source (a
  // jobboard) hijack the employer's canonical link — which would churn "Postuler
  // chez [Maison]" between the real employer and a jobboard copy on every cycle
  // (breaks D18). tierRank: lower number = higher priority.
  const sameOrHigherTier = tierRank(candidate.sourceTier) <= tierRank(existing.canonicalTier ?? '');
  const urlRefresh = !promoted && sameOrHigherTier && candidate.url && candidate.url !== existing.url;

  await prisma.job.update({
    where: { id: existing.id },
    data: {
      lastSeenAt: now,
      isActive: true,
      // Every touch carries the current generation, so a merged offer is never
      // left below the version line and re-purged on the next run.
      pipelineVersion: PIPELINE_VERSION,
      ...(promoted
        ? {
            url: candidate.url,
            canonicalTier: candidate.sourceTier,
            title: candidate.title,
            // Keep the richest description available across sources.
            ...(candidate.description && candidate.description.length > (existing.description?.length ?? 0)
              ? { description: candidate.description }
              : {}),
          }
        : urlRefresh
          ? { url: candidate.url }
          : {}),
    },
  });

  return {
    jobId: existing.id,
    outcome: alreadyKnown ? 'UPDATED' : 'MERGED',
    promoted,
  };
}
