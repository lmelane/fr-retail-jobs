import type { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { loadActiveSources } from '../connectors/sourceStore.js';
import { runIngest, KIND_TO_ATS } from './ingest.js';
import { checkSourceHealth, type SourceHealth } from './health.js';
import { briefError } from '../lib/normalize.js';

/**
 * Runs every source under its OWN time budget (decision D6), a few at a time.
 *
 * A single run of all 102 sources took 21 minutes and was killed by the platform
 * before it reached one API feed — the reason production held a handful of
 * employers. Here each source is ingested in-process but bounded by a timeout:
 * a feed that hangs is abandoned and the next one starts, so no single source
 * can starve the run, whatever the volume.
 *
 * In-process rather than a child process per source: spawning `tsx` 102 times
 * pays a TypeScript recompile (~10s) on every source — minutes of pure overhead.
 * A per-source timeout gives the same isolation for a hung feed without it. A
 * source that throws is caught; geocoding runs ONCE, after the loop, in the CLI.
 *
 * API feeds run first (cheap, the bulk of the market), sitemap sources last.
 */

/**
 * Abandon a single source after this long — a stuck feed must not block the rest.
 *
 * 20 minutes, not 6: the giants (Kering's 14 Maisons, L'Oréal, FashionJobs'
 * 7611 offers via a browser) legitimately need well over six minutes to fetch
 * and dedup, and cutting them short lost exactly the feeds that expose the most
 * houses. They run LAST (smallest-first ordering), so the long budget only
 * applies once the quick feeds are already in.
 */
// 40 min depuis D36 (cadence quotidienne, 4 voies) : à 20 min, Michael Page
// ne lisait que 1 450 offres sur 3 334 par run et la queue de sa liste n'était
// jamais revue — fermée à 48 h, vivante ou non (audit A5, 2026-09-06).
const PER_SOURCE_TIMEOUT_MS = Number(process.env.INGEST_SOURCE_TIMEOUT_MS ?? 40 * 60_000);

/**
 * How long before the hard timeout a slow crawl should stop itself. The margin
 * lets the adapter finish the page it is on and return cleanly — the graceful
 * stop that keeps its work — rather than being cut mid-flight by withTimeout.
 */
const SOFT_DEADLINE_MARGIN_MS = 90_000;

/**
 * How many sources run at once.
 *
 * Mesuré le 2026-09-06 (chronométrage des logs, `runTiming.mts`) : 470
 * sources en SÉRIE = 3 h 28 pour un cron de 4 h, dont 76 % du temps sur 15
 * sources (Michael Page 19 min, L'Oréal 17, Lacoste 16, Kering 12…) — des
 * visites de pages de détail à concurrence 4, chacune attendant son hôte.
 * Pendant qu'une source attend son hôte, les 469 autres attendaient aussi.
 *
 * Paralléliser les SOURCES ne change rien au débit PAR HÔTE : la porte par
 * hôte (D25, `hostGate.ts`) borne la concurrence et le délai sur chaque hôte,
 * quel que soit le nombre de sources qui le visitent. Des sources sur des
 * hôtes différents ne s'attendent donc plus ; celles qui partagent un hôte
 * (les Maisons Richemont, ELC) se sérialisent d'elles-mêmes à la porte.
 *
 * Quatre, pas plus : le pool Prisma du service est à 8 connexions, et
 * l'écriture ne tient jamais de transaction interactive (la purge est un
 * batch), donc quatre sources qui écrivent ne peuvent pas s'inter-bloquer.
 */
const SOURCE_CONCURRENCY = Number(process.env.INGEST_SOURCE_CONCURRENCY ?? 4);

export type OrchestratorResult = {
  total: number;
  ok: number;
  failed: number;
  timedOut: number;
  failures: string[];
  /** Sources that returned degraded/broken health this run — feeds the alert. */
  incidents: SourceHealth[];
};

/**
 * Every source key, API feeds first then sitemap sources — and within the API
 * feeds, SMALLEST FIRST.
 *
 * The volume is wildly uneven: Foot Locker (2794) and L'Oréal Pro re-fetch
 * thousands of offers and eat minutes each, while most Maisons have well under a
 * hundred. Ordering the small feeds first means a run that is cut short has
 * still covered the maximum number of distinct Maisons — dozens of houses on the
 * board — instead of stalling on two giants and reaching no one else. The few
 * large feeds run last, where a cut costs the fewest employers.
 */
export async function allSourceKeys(prisma: PrismaClient): Promise<string[]> {
  const apiKeys = (await loadActiveSources(prisma))
    .filter((source) => KIND_TO_ATS[source.kind])
    .sort((a, b) => (a.jobCount || 0) - (b.jobCount || 0))
    .map((source) => source.key);
  return onlyRequested([...new Set(apiKeys)]);
}

/**
 * Run ciblé (décision Loïc, 2026-09-06) : « on arrête les runs trop longs,
 * il faut une solution localisée ». `INGEST_ONLY_KEYS="hermes,kering"` posé
 * sur le service Railway limite le run aux clés listées — depuis l'egress de
 * la prod (D32 : un poste local n'a pas le même), en quelques minutes, sans
 * les 490 autres sources. Une clé inconnue est signalée, pas ignorée en
 * silence. Vide ou absente : run complet.
 */
export function onlyRequested(keys: string[], raw = process.env.INGEST_ONLY_KEYS): string[] {
  const wanted = (raw ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  if (wanted.length === 0) return keys;
  const known = new Set(keys);
  const unknown = wanted.filter((k) => !known.has(k));
  if (unknown.length > 0) throw new Error(`INGEST_ONLY_KEYS : clés inconnues ou inactives — ${unknown.join(', ')}`);
  const set = new Set(wanted);
  return keys.filter((k) => set.has(k));
}

/** Rejects if the work does not settle within the budget. */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`__TIMEOUT__ ${label}`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export async function ingestAllBySource(prisma: PrismaClient): Promise<OrchestratorResult> {
  const keys = await allSourceKeys(prisma);
  console.log(`[orchestrator] ${keys.length} sources, each time-bounded: ${keys.join(', ')}`);

  const result: OrchestratorResult = { total: keys.length, ok: 0, failed: 0, timedOut: 0, failures: [], incidents: [] };

  // Smallest-first order is preserved by the limiter: the giants are still
  // started last, and now run side by side instead of one after the other.
  const limit = pLimit(SOURCE_CONCURRENCY);
  await Promise.all(keys.map((key) => limit(() => ingestOne(prisma, key, result))));

  console.log(
    `[orchestrator] done: ${result.ok}/${result.total} ok, ${result.failed} failed, ${result.timedOut} timed out` +
      (result.failures.length ? ` — ${result.failures.join(', ')}` : ''),
  );
  return result;
}

/** One source, bounded by its own timeout; the counters it touches are shared. */
async function ingestOne(prisma: PrismaClient, key: string, result: OrchestratorResult): Promise<void> {
  try {
    // runIngest with {only} does the source's own purge; geocoding is skipped
    // here and run ONCE by the CLI after every source — a per-source pass
    // would run four times over the same cities in parallel. The soft
    // deadline lets a slow crawl stop gracefully just before the hard
    // timeout, keeping what it fetched.
    const deadlineMs = Date.now() + PER_SOURCE_TIMEOUT_MS - SOFT_DEADLINE_MARGIN_MS;
    const stats = await withTimeout(
      runIngest(prisma, { only: key, deadlineMs, skipGeocode: true }),
      PER_SOURCE_TIMEOUT_MS,
      key,
    );
    // Record this source's health so a source that stops producing becomes a
    // detectable incident (BROKEN) on its next run — one SourceRun per source.
    // Collect any incident so the run can send ONE digest at the end.
    const health = await checkSourceHealth(prisma, stats).catch((e) => {
      console.error(`[orchestrator] ${key}: health record failed — ${e instanceof Error ? e.message : e}`);
      return null;
    });
    if (health) result.incidents.push(...health.incidents);
    result.ok++;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = message.startsWith('__TIMEOUT__');
    if (timedOut) {
      result.timedOut++;
      result.failures.push(`${key} (timedOut)`);
      console.error(`[orchestrator] ${key}: timed out after ${PER_SOURCE_TIMEOUT_MS / 1000}s, moving on`);
    } else {
      result.failed++;
      result.failures.push(`${key} (failed)`);
      console.error(`[orchestrator] ${key}: failed — ${briefError(error)}`);
    }
    // L-01: a source that did not finish gets a SourceRun anyway — TIMEOUT or
    // ERROR — so the refresh knows its offers were NOT re-attested this run
    // and leaves them open. Without this row the refresh saw only silence,
    // which is indistinguishable from "the source listed nothing".
    await prisma.sourceRun
      .create({
        data: {
          sourceKey: key,
          status: timedOut ? 'TIMEOUT' : 'ERROR',
          jobs: 0,
          note: timedOut ? `cut at ${PER_SOURCE_TIMEOUT_MS / 1000}s` : briefError(error),
        },
      })
      .catch((e) => console.error(`[orchestrator] ${key}: failed to record run — ${briefError(e)}`));
  }
}
