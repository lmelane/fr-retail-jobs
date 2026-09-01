import type { PrismaClient, AtsType } from '@prisma/client';
import pLimit from 'p-limit';
import { fetchAtsJobs } from '../ats/index.js';
import { classifySector } from '../normalize/sector.js';
import { resolveCompany } from '../normalize/company.js';
import { normalizeContract } from '../normalize/contract.js';
import { isFranceJob } from '../lib/france.js';
import { upsertDeduplicated } from '../dedup/upsert.js';
import type { CandidateJob, SourceTier } from '../dedup/match.js';

/**
 * ATS ingestion — one request per EMPLOYER instead of one per offer.
 *
 * This is the difference that decides whether a run finishes. Through its
 * sitemap, L'Oréal costs 1734 page fetches at ~260ms each; through an ATS API it
 * costs one call that returns every posting WITH its full description. Verified
 * 2026-09-01: Greenhouse returned 163 jobs and 6.7k-character descriptions in a
 * single response, Ashby 67 jobs with 20k-character ones.
 *
 * So the sitemap connector is the FALLBACK, for employers with no public ATS —
 * not the default path it had become.
 */

const CONCURRENCY = Number(process.env.ATS_CONCURRENCY ?? 6);

export type AtsEmployer = {
  /** Display name; also what the sector filter and dedup resolve on. */
  company: string;
  ats: AtsType;
  /** Adapter config: { board } / { site } / { subdomain } / { tenant, site }… */
  config: Record<string, unknown>;
  tier: SourceTier;
  /** Registry key for JobSource rows. */
  sourceKey: string;
};

export type AtsIngestStats = {
  employer: string;
  ats: string;
  fetched: number;
  france: number;
  created: number;
  merged: number;
  updated: number;
  errors: number;
};

async function ingestEmployer(
  prisma: PrismaClient,
  employer: AtsEmployer,
): Promise<AtsIngestStats> {
  const stats: AtsIngestStats = {
    employer: employer.company,
    ats: employer.ats,
    fetched: 0,
    france: 0,
    created: 0,
    merged: 0,
    updated: 0,
    errors: 0,
  };

  const jobs = await fetchAtsJobs(employer.ats, employer.config);
  stats.fetched = jobs.length;

  // The employer is known up front here, unlike a jobboard, so classify once.
  if (!classifySector({ company: employer.company }).inScope) return stats;

  for (const job of jobs) {
    if (!isFranceJob(job.country, job.location)) continue;
    stats.france++;

    const candidate: CandidateJob & { companyId: string } = {
      ...job,
      contract: normalizeContract(job.contract),
      company: employer.company,
      companyId: resolveCompany(employer.company).companyId,
      sourceKey: employer.sourceKey,
      sourceTier: employer.tier,
    };

    try {
      const result = await upsertDeduplicated(prisma, candidate);
      if (result.outcome === 'CREATED') stats.created++;
      else if (result.outcome === 'MERGED') stats.merged++;
      else stats.updated++;
    } catch (error) {
      stats.errors++;
      if (stats.errors <= 2) {
        console.error(
          `[ats] ${employer.company} write failed:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  console.log(
    `[ats] ${employer.company} (${employer.ats}): ${stats.france} FR / ${stats.fetched} fetched -> ` +
      `${stats.created} created, ${stats.merged} merged, ${stats.updated} updated`,
  );
  return stats;
}

export async function runAtsIngest(
  prisma: PrismaClient,
  employers: readonly AtsEmployer[],
): Promise<AtsIngestStats[]> {
  console.log(`[ats] ${employers.length} employers`);
  const limit = pLimit(CONCURRENCY);

  return Promise.all(
    employers.map((employer) =>
      limit(async () => {
        try {
          return await ingestEmployer(prisma, employer);
        } catch (error) {
          console.error(
            `[ats] ${employer.company} failed:`,
            error instanceof Error ? error.message : String(error),
          );
          return {
            employer: employer.company,
            ats: employer.ats,
            fetched: 0,
            france: 0,
            created: 0,
            merged: 0,
            updated: 0,
            errors: 1,
          } satisfies AtsIngestStats;
        }
      }),
    ),
  );
}
