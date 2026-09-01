import type { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { plainHttpSources, type JobSource as SourceDef } from '../connectors/registry.js';
import { fetchSitemapUrls, fetchJobFromPage } from '../connectors/generic/jsonLdSitemap.js';
import { classifySector } from '../normalize/sector.js';
import { resolveCompany } from '../normalize/company.js';
import { normalizeContract } from '../normalize/contract.js';
import { isFranceJob } from '../lib/france.js';
import { upsertDeduplicated } from '../dedup/upsert.js';
import type { CandidateJob } from '../dedup/match.js';
import type { NormalizedJob } from '../types.js';

/**
 * INGEST — picks up new and updated offers.
 *
 * Runs often and stays light: it reads sitemaps and feeds, then writes through
 * the deduplicating upsert so a duplicate never reaches the database, not even
 * for a second. Sector filtering happens BEFORE any write — on one Welcome to the
 * Jungle shard only 4.2% of French offers were in our vertical, so admitting
 * everything would drown the base in noise.
 */

const CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 4);
/** Cap per source per run, so one huge sitemap cannot monopolise a cron slot. */
const MAX_JOBS_PER_SOURCE = Number(process.env.INGEST_MAX_PER_SOURCE ?? 500);

export type IngestStats = {
  source: string;
  fetched: number;
  inSector: number;
  france: number;
  created: number;
  merged: number;
  updated: number;
  errors: number;
};

function toCandidate(
  job: NormalizedJob,
  source: SourceDef,
  companyName: string,
): CandidateJob & { companyId: string } {
  return {
    ...job,
    contract: normalizeContract(job.contract),
    company: companyName,
    companyId: resolveCompany(companyName).companyId,
    sourceKey: source.key,
    sourceTier: source.tier,
  };
}

async function ingestSitemapSource(
  prisma: PrismaClient,
  source: SourceDef,
): Promise<IngestStats> {
  const stats: IngestStats = {
    source: source.key,
    fetched: 0,
    inSector: 0,
    france: 0,
    created: 0,
    merged: 0,
    updated: 0,
    errors: 0,
  };

  const urls = (await fetchSitemapUrls(source.entryUrl)).slice(0, MAX_JOBS_PER_SOURCE);
  // Respect a host's declared crawl-delay rather than hammering it.
  const limit = pLimit(source.crawlDelaySeconds ? 1 : CONCURRENCY);
  const delayMs = (source.crawlDelaySeconds ?? 0) * 1000;

  const jobs = await Promise.all(
    urls.map((url) =>
      limit(async () => {
        try {
          const job = await fetchJobFromPage(url);
          if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
          return job;
        } catch {
          stats.errors++;
          return null;
        }
      }),
    ),
  );

  for (const job of jobs) {
    if (!job) continue;
    stats.fetched++;

    // The employer name comes from the posting itself when present; the registry
    // name is the fallback for feeds that omit it.
    const rawCompany =
      (job.raw as { hiringOrganization?: { name?: string } } | undefined)?.hiringOrganization?.name ??
      source.company;

    if (!classifySector({ company: rawCompany, title: job.title }).inScope) continue;
    stats.inSector++;

    if (!isFranceJob(job.country, job.location)) continue;
    stats.france++;

    try {
      const result = await upsertDeduplicated(prisma, toCandidate(job, source, rawCompany));
      if (result.outcome === 'CREATED') stats.created++;
      else if (result.outcome === 'MERGED') stats.merged++;
      else stats.updated++;
    } catch {
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Runs every plain-HTTP source. Browser-gated sources (FashionJobs, LVMH) are
 * handled by their own connectors, not here.
 */
export async function runIngest(prisma: PrismaClient): Promise<IngestStats[]> {
  const sources = plainHttpSources().filter((source) => source.kind === 'SITEMAP_JSONLD');
  const results: IngestStats[] = [];

  for (const source of sources) {
    try {
      results.push(await ingestSitemapSource(prisma, source));
    } catch (error) {
      results.push({
        source: source.key,
        fetched: 0,
        inSector: 0,
        france: 0,
        created: 0,
        merged: 0,
        updated: 0,
        errors: 1,
      });
      console.error(
        `[ingest] ${source.key} failed:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return results;
}
