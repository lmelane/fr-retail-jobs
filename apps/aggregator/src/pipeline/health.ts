import type { PrismaClient } from '@prisma/client';
import type { IngestStats } from './ingest.js';
import { recordSourceRunSummary } from '../connectors/sourceStore.js';

/**
 * Source health, run after every ingest.
 *
 * An aggregator does not break loudly. Vendors rotate a public search key, move
 * a listing path, or start refusing a non-browser client, and the adapter for
 * that source quietly returns zero. The cron still exits 0, the dashboard still
 * says "success", and the only visible symptom is a Maison that stopped having
 * openings — which looks exactly like a Maison that stopped hiring.
 *
 * This has already happened twice here: a rotated Welcome to the Jungle key put
 * false "no ATS" verdicts in three discovery batches, and Estée Lauder's board
 * began answering every request with a human-verification page.
 *
 * So each run compares what a source returned against what it returned before,
 * and a source that WAS producing and now produces nothing is an incident — not
 * a quiet zero.
 */

/** A drop below this share of the previous run is treated as a failure. */
const COLLAPSE_RATIO = 0.5;

/** Runs to keep per source; enough to see a trend without growing forever. */
const HISTORY = 10;

export type SourceHealth = {
  source: string;
  status: 'OK' | 'DEGRADED' | 'BROKEN' | 'NEW';
  jobs: number;
  previous: number | null;
  note?: string;
  /** "desc 62% date 0% pays 88% url 100%" — recorded on every run for trend. */
  coverage?: string;
  /** Same rates as numbers 0..1, written to SourceRun/Source COLUMNS (L-02). */
  rates?: { description: number; date: number; country: number; url: number };
};

/**
 * Field-coverage floors (audit L-02 generalized). A source can keep its volume
 * while silently losing a field — 3 780 Eightfold offers lost their description
 * behind a renamed API key and nothing alerted. Gated: description and apply
 * URL, the two direct product promises. Date and country are RECORDED for
 * trend but not gated — several honest feeds never ship them (LVMH has no date
 * field at all), and a permanent alert is noise that trains people to ignore
 * the digest; their fix is per-adapter work (F-05), tracked by the rates.
 */
const DESCRIPTION_FLOOR = 0.7;
const URL_FLOOR = 0.99;
/** Below this many offers, rates flap on nothing — skip the gate. */
const COVERAGE_MIN_JOBS = 20;

export type HealthReport = {
  checkedAt: Date;
  ok: number;
  degraded: number;
  broken: number;
  incidents: SourceHealth[];
};

/**
 * Compares this run's per-source counts with the PREVIOUS run's.
 *
 * The baseline is the last SourceRun recorded for each source — not the live
 * JobSource state. Reading live state compared a run to itself: checkSourceHealth
 * runs right after the ingest has already written this run's rows, so "before"
 * included "now" and a source that returned zero still looked healthy until the
 * refresh pass emptied it 48h later — exactly when the alert was needed.
 */
export async function checkSourceHealth(
  prisma: PrismaClient,
  stats: IngestStats[],
): Promise<HealthReport> {
  const previous = await previousCounts(prisma);
  const results: SourceHealth[] = [];

  for (const stat of stats) {
    const jobs = stat.created + stat.merged + stat.updated;
    const before = previous.get(stat.source) ?? null;

    if (before === null) {
      results.push({ source: stat.source, status: 'NEW', jobs, previous: null });
      continue;
    }

    // Zero from a source that was producing is the signal that matters most:
    // it is what a rotated key, a moved path and a new bot shield all look like.
    if (jobs === 0 && before > 0) {
      results.push({
        source: stat.source,
        status: 'BROKEN',
        jobs,
        previous: before,
        note: `returned nothing, held ${before} offers on the previous run`,
      });
      continue;
    }

    if (before > 0 && jobs < before * COLLAPSE_RATIO) {
      results.push({
        source: stat.source,
        status: 'DEGRADED',
        jobs,
        previous: before,
        note: `${Math.round((1 - jobs / before) * 100)}% fewer offers than the previous run`,
        coverage: coverageOf(stat),
        rates: ratesOf(stat),
      });
      continue;
    }

    // Truncation (F-04): the source ANNOUNCED more than the sweep collected.
    // Volume can look healthy run-over-run while a page cap silently hides
    // most of the board — Talentsoft served a clean 20 while declaring 112.
    if (stat.truncated && stat.declaredTotal) {
      results.push({
        source: stat.source,
        status: 'DEGRADED',
        jobs,
        previous: before,
        note: `troncature : ${stat.fetched} collectées sur ${stat.declaredTotal} déclarées`,
        coverage: coverageOf(stat),
        rates: ratesOf(stat),
      });
      continue;
    }

    // Volume held — but did the FIELDS? (The Eightfold failure mode.)
    const fieldIncident = fieldCoverageIncident(stat);
    if (fieldIncident) {
      results.push({
        source: stat.source,
        status: 'DEGRADED',
        jobs,
        previous: before,
        note: fieldIncident,
        coverage: coverageOf(stat),
        rates: ratesOf(stat),
      });
      continue;
    }

    results.push({
      source: stat.source,
      status: 'OK',
      jobs,
      previous: before,
      coverage: coverageOf(stat),
      rates: ratesOf(stat),
    });
  }

  await recordRun(prisma, results);

  const incidents = results.filter((r) => r.status === 'BROKEN' || r.status === 'DEGRADED');
  return {
    checkedAt: new Date(),
    ok: results.filter((r) => r.status === 'OK').length,
    degraded: results.filter((r) => r.status === 'DEGRADED').length,
    broken: results.filter((r) => r.status === 'BROKEN').length,
    incidents,
  };
}

function coverageOf(stat: IngestStats): string | undefined {
  if (!stat.fetched) return undefined;
  const pct = (n: number) => `${Math.round((n / stat.fetched) * 100)}%`;
  return `desc ${pct(stat.withDescription)} date ${pct(stat.withDate)} pays ${pct(stat.withCountry)} url ${pct(stat.withUrl)}`;
}

/** The same coverage as numbers, for the queryable columns (L-02). */
function ratesOf(stat: IngestStats): SourceHealth['rates'] {
  if (!stat.fetched) return undefined;
  const rate = (n: number) => Math.round((n / stat.fetched) * 1000) / 1000;
  return {
    description: rate(stat.withDescription),
    date: rate(stat.withDate),
    country: rate(stat.withCountry),
    url: rate(stat.withUrl),
  };
}

/** The gate itself: a big-enough source below a floor is an incident. */
function fieldCoverageIncident(stat: IngestStats): string | undefined {
  if (stat.fetched < COVERAGE_MIN_JOBS) return undefined;
  if (stat.withDescription / stat.fetched < DESCRIPTION_FLOOR) {
    return `descriptions manquantes sur ${Math.round((1 - stat.withDescription / stat.fetched) * 100)}% des offres`;
  }
  if (stat.withUrl / stat.fetched < URL_FLOOR) {
    return `URL de candidature invalide/vide sur ${stat.fetched - stat.withUrl} offres`;
  }
  return undefined;
}

/**
 * What each source produced on its LAST recorded run.
 *
 * Read from SourceRun (the run-by-run history), taken before this run records
 * itself, so the baseline is genuinely the previous run — not this one. A source
 * with no history returns nothing and is treated as NEW.
 */
async function previousCounts(prisma: PrismaClient): Promise<Map<string, number>> {
  // Most recent first; the first row seen per source is its last run.
  const rows = await prisma.sourceRun.findMany({
    orderBy: { ranAt: 'desc' },
    select: { sourceKey: true, jobs: true },
  });
  const latest = new Map<string, number>();
  for (const row of rows) {
    if (!latest.has(row.sourceKey)) latest.set(row.sourceKey, row.jobs);
  }
  return latest;
}

async function recordRun(prisma: PrismaClient, results: SourceHealth[]): Promise<void> {
  const now = new Date();
  await Promise.all(
    results.map(async (result) => {
      await prisma.sourceRun.create({
        data: {
          sourceKey: result.source,
          status: result.status,
          jobs: result.jobs,
          previousJobs: result.previous,
          // The coverage rates ride along on EVERY run, incident or not: they
          // are the trend the next regression gets caught against. Columns
          // carry the queryable numbers; the note stays human-readable.
          note: [result.note, result.coverage].filter(Boolean).join(' · ') || null,
          descriptionRate: result.rates?.description ?? null,
          dateRate: result.rates?.date ?? null,
          countryRate: result.rates?.country ?? null,
          urlRate: result.rates?.url ?? null,
          ranAt: now,
        },
      });
      // Denormalized onto the catalogue row too, so « how is this source
      // doing » is one query on Source (DEC-3).
      await recordSourceRunSummary(prisma, result.source, {
        status: result.status,
        jobs: result.jobs,
        descriptionRate: result.rates?.description,
        dateRate: result.rates?.date,
        countryRate: result.rates?.country,
        urlRate: result.rates?.url,
      });
    }),
  );

  // Keep the table bounded: history is for spotting a trend, not an archive.
  const stale = await prisma.sourceRun.findMany({
    where: { ranAt: { lt: new Date(now.getTime() - HISTORY * 86_400_000) } },
    select: { id: true },
    take: 5000,
  });
  if (stale.length > 0) {
    await prisma.sourceRun.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
  }
}
