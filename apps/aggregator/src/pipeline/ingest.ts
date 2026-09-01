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

/**
 * One HTTP request per offer at ~260ms measured means 500 offers take 2.2 min for
 * a single source, and eight sources 17 minutes — with no output until the very
 * end, so the container just looks hung. Hence real parallelism plus progress
 * logging: a silent pipeline is indistinguishable from a broken one.
 */
const CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 12);
/** Cap per source per run; the rest is picked up by the next cron tick. */
const MAX_JOBS_PER_SOURCE = Number(process.env.INGEST_MAX_PER_SOURCE ?? 250);

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
  console.log(`[ingest] ${source.key}: ${urls.length} URLs`);

  // A declared crawl-delay forces serial fetching; otherwise run in parallel.
  const limit = pLimit(source.crawlDelaySeconds ? 1 : CONCURRENCY);
  const delayMs = (source.crawlDelaySeconds ?? 0) * 1000;

  // Write as results arrive instead of buffering the whole source: a crash
  // partway through then keeps everything already ingested.
  await Promise.all(
    urls.map((url) =>
      limit(async () => {
        let job;
        try {
          job = await fetchJobFromPage(url);
          if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        } catch {
          stats.errors++;
          return;
        }
        if (!job) return;
        stats.fetched++;

        // The employer name comes from the posting when present; the registry
        // name is the fallback for feeds that omit it.
        const rawCompany =
          (job.raw as { hiringOrganization?: { name?: string } } | undefined)?.hiringOrganization
            ?.name ?? source.company;

        if (!classifySector({ company: rawCompany, title: job.title }).inScope) return;
        stats.inSector++;

        if (!isFranceJob(job.country, job.location)) return;
        stats.france++;

        try {
          const result = await upsertDeduplicated(prisma, toCandidate(job, source, rawCompany));
          if (result.outcome === 'CREATED') stats.created++;
          else if (result.outcome === 'MERGED') stats.merged++;
          else stats.updated++;
        } catch (error) {
          stats.errors++;
          if (stats.errors <= 3) {
            console.error(
              `[ingest] ${source.key} write failed:`,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      }),
    ),
  );

  console.log(
    `[ingest] ${source.key}: ${stats.france} FR / ${stats.inSector} in-sector / ${stats.fetched} fetched -> ` +
      `${stats.created} created, ${stats.merged} merged, ${stats.errors} errors`,
  );
  return stats;
}

/**
 * Runs every plain-HTTP source. Browser-gated sources (FashionJobs, LVMH) are
 * handled by their own connectors, not here.
 */
export async function runIngest(prisma: PrismaClient): Promise<IngestStats[]> {
  const sources = plainHttpSources()
    .filter((source) => source.kind === 'SITEMAP_JSONLD')
    // Skip EMPLOYER sources the sector filter would reject anyway: Decathlon
    // alone declares a 10s crawl-delay, so 250 offers cost 42 minutes entirely
    // spent fetching pages that get discarded at classification.
    //
    // Jobboards are never skipped here — their employer varies per offer, so
    // filtering on the board's own name would drop the whole board.
    .filter(
      (source) => source.flow === 'JOBBOARD' || classifySector({ company: source.company }).inScope,
    )
    // Cheapest sources first: a run that gets cut short should still have
    // written the offers that cost the least to obtain.
    .sort((a, b) => (a.crawlDelaySeconds ?? 0) - (b.crawlDelaySeconds ?? 0));

  console.log(`[ingest] ${sources.length} sources: ${sources.map((s) => s.key).join(', ')}`);
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
