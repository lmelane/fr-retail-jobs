import { prisma, Prisma } from '@catwalks/db';
import { DatabaseUnavailableError } from '@/lib/jobs';
import type { SnapshotPoint } from './metrics';

/**
 * Lecture de `MarketSnapshot` — la photographie quotidienne écrite par le
 * pipeline (un chantier parallèle ; la table peut être VIDE). Toute comparaison
 * J-7 / J-30 / M-3 / M-12 passe par ici, jamais par Job : les offres se
 * ferment et se suppriment, la photographie reste.
 *
 * Scopes écrits (brief) : global (clé ''), country (ISO-2), city (`CC|Ville`),
 * company (Company.id), group, sector, function, seniority, contract, family,
 * ai ('true'), country-function (`CC|fonction`), country-sector (`CC|SECTEUR`).
 *
 * Seules les photographies prises EN DIRECT (`mode = 'live'`) sont lues ici.
 * Les jours reconstruits (`--backfill-from`) sont une approximation depuis
 * l'état actuel des offres : mesuré en prod le 2026-09-06, Cartier affichait un
 * indice base 100 de 457,6 parce que la base était le 4 septembre reconstruit,
 * quand ses sources n'étaient pas encore au catalogue. Un indice, une variation,
 * un momentum ne se calculent que sur ce qui a été réellement observé.
 */
const LIVE = Prisma.sql`AND mode = 'live'`;

export type SnapshotScope =
  | 'global'
  | 'country'
  | 'city'
  | 'company'
  | 'group'
  | 'sector'
  | 'function'
  | 'seniority'
  | 'contract'
  | 'family'
  | 'ai'
  | 'country-function'
  | 'country-sector';

async function run<T>(query: Prisma.Sql): Promise<T[]> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    return await prisma.$queryRaw<T[]>(query);
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

/** Série datée croissante d'un périmètre, sur les `days` derniers jours (défaut : tout). */
export async function series(scope: SnapshotScope, key: string, days?: number): Promise<SnapshotPoint[]> {
  const since = days ? Prisma.sql`AND date >= (CURRENT_DATE - ${days}::int)` : Prisma.empty;
  const rows = await run<{
    date: string; activeJobs: number; newJobs: number; closedJobs: number; hiringCompanies: number;
    medianLifespanDays: number | null; reopenedJobs: number;
  }>(Prisma.sql`
    SELECT to_char(date, 'YYYY-MM-DD') AS "date", "activeJobs", "newJobs", "closedJobs", "hiringCompanies",
           "medianLifespanDays"::float AS "medianLifespanDays", "reopenedJobs"
    FROM "MarketSnapshot" WHERE scope = ${scope} AND key = ${key} ${LIVE} ${since} ORDER BY date ASC`);
  return rows.map((r) => ({
    date: r.date,
    activeJobs: r.activeJobs,
    newJobs: r.newJobs,
    closedJobs: r.closedJobs,
    hiringCompanies: r.hiringCompanies,
    medianLifespanDays: r.medianLifespanDays,
    reopenedJobs: r.reopenedJobs,
  }));
}

/** Date du premier snapshot global pris EN DIRECT (ISO date), null s'il n'y en a pas encore. */
export async function firstSnapshotDate(): Promise<string | null> {
  const [row] = await run<{ first: string | null }>(Prisma.sql`
    SELECT to_char(min(date), 'YYYY-MM-DD') AS "first" FROM "MarketSnapshot" WHERE scope = 'global' ${LIVE}`);
  return row?.first ?? null;
}

/** Nombre de jours de snapshot d'un périmètre. */
export async function snapshotDays(scope: SnapshotScope, key: string): Promise<number> {
  const [row] = await run<{ n: number }>(Prisma.sql`
    SELECT count(*)::int AS n FROM "MarketSnapshot" WHERE scope = ${scope} AND key = ${key} ${LIVE}`);
  return row?.n ?? 0;
}

/**
 * Dernier point de chaque clé d'un scope (ex. : la dernière valeur de chaque
 * pays) — sert « où le recrutement accélère » : on compare au point J-7 exact.
 */
export async function latestAndBefore(scope: SnapshotScope, daysBack: number): Promise<{ key: string; now: SnapshotPoint; before: SnapshotPoint | null }[]> {
  const rows = await run<{
    key: string; date: string; activeJobs: number; newJobs: number; closedJobs: number; hiringCompanies: number;
    medianLifespanDays: number | null; reopenedJobs: number; isNow: boolean;
  }>(Prisma.sql`
    WITH last AS (SELECT max(date) AS d FROM "MarketSnapshot" WHERE scope = ${scope} ${LIVE})
    SELECT key, to_char(date, 'YYYY-MM-DD') AS "date", "activeJobs", "newJobs", "closedJobs", "hiringCompanies",
           "medianLifespanDays"::float AS "medianLifespanDays", "reopenedJobs", (date = last.d) AS "isNow"
    FROM "MarketSnapshot", last
    WHERE scope = ${scope} ${LIVE} AND (date = last.d OR date = last.d - ${daysBack}::int)`);
  const byKey = new Map<string, { now?: SnapshotPoint; before?: SnapshotPoint }>();
  for (const r of rows) {
    const point: SnapshotPoint = {
      date: r.date, activeJobs: r.activeJobs, newJobs: r.newJobs, closedJobs: r.closedJobs,
      hiringCompanies: r.hiringCompanies, medianLifespanDays: r.medianLifespanDays, reopenedJobs: r.reopenedJobs,
    };
    const cur = byKey.get(r.key) ?? {};
    if (r.isNow) cur.now = point;
    else cur.before = point;
    byKey.set(r.key, cur);
  }
  return [...byKey.entries()]
    .filter((e): e is [string, { now: SnapshotPoint; before?: SnapshotPoint }] => e[1].now !== undefined)
    .map(([key, v]) => ({ key, now: v.now, before: v.before ?? null }));
}
