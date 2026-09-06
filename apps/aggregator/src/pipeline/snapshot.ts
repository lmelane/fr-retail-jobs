import { Prisma, type PrismaClient } from '@prisma/client';
import { chunk } from '../lib/chunk.js';

/**
 * Photographie quotidienne du marché (Catwalks Intelligence, D38).
 *
 * Une ligne `MarketSnapshot` par (jour, périmètre, clé) : le nombre d'offres
 * actives, nouvelles, fermées, le nombre de Maisons qui recrutent, la durée
 * de publication médiane des offres fermées ce jour-là, les ré-ouvertures.
 * Les comparaisons J-7 / J-30 / M-12 lisent cette table, jamais `Job` : les
 * offres se ferment et se suppriment (`retire-source`), la photographie reste.
 *
 * Tout est agrégé en SQL (GROUP BY sur une CTE commune) : la base fait
 * 70 000 offres actives, on ne les charge jamais en mémoire. Idempotent :
 * rejouer un jour efface ses lignes et les ré-écrit dans une transaction.
 *
 * Deux modes, choisis par la date :
 *  - `live` (le jour même) : « active » = `Job.isActive`, la vérité du moment ;
 *  - `reconstructed` (un jour passé, `--backfill-from`) : « active au jour J »
 *    = `firstSeenAt` avant la fin de J et pas fermée avant la fin de J. C'est
 *    une RECONSTRUCTION approximative : les offres supprimées par
 *    `retire-source` n'y sont plus, et avant le 2026-09-04 la base était
 *    reconstruite à chaque run (les `firstSeenAt` de cette époque sont ceux
 *    de la reconstruction, pas de la publication). Une offre fermée avant que
 *    `closedAt` existe (isActive=false, closedAt null) est considérée fermée à
 *    son `lastSeenAt` — sans cela, chaque fermeture d'avant D38 compterait
 *    comme active pour toujours.
 */

export const SNAPSHOT_SCOPES = [
  'global', 'country', 'city', 'company', 'group', 'sector', 'function', 'family',
  'seniority', 'contract', 'ai', 'country-function', 'country-sector',
] as const;
export type SnapshotScope = (typeof SNAPSHOT_SCOPES)[number];

/** Sépare les parties d'une clé composée : `FR|Paris`, `FR|retail-client-advisor`. */
export const KEY_SEPARATOR = '|';

/** Une ville, un croisement pays×métier ou pays×secteur n'existe qu'à partir de 5 offres actives. */
export const MIN_ACTIVE_FOR_CROSS = 5;

/** Les métiers de la famille « atelier » : `isRetail=false` couvre corporate ET craft, la fonction tranche. */
export const CRAFT_FUNCTIONS = ['atelier-craft', 'manufacturing-quality'] as const;

export const UNCLASSIFIED_KEY = 'unclassified';
export const UNKNOWN_CONTRACT_KEY = 'UNKNOWN';

export function compositeKey(...parts: string[]): string {
  return parts.join(KEY_SEPARATOR);
}

export function splitCompositeKey(key: string): string[] {
  return key.split(KEY_SEPARATOR);
}

/** `YYYY-MM-DD` → minuit UTC de ce jour. Refuse tout autre format : une date ambiguë ferait un faux jour. */
export function parseDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid day "${value}": expected YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid day "${value}": not a calendar date`);
  }
  return date;
}

/** Le jour UTC d'un instant : minuit inclus, minuit suivant exclu. */
export function dayBounds(instant: Date): { day: Date; start: Date; end: Date } {
  const day = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
  return { day, start: day, end: new Date(day.getTime() + 86_400_000) };
}

export function formatDay(day: Date): string {
  return day.toISOString().slice(0, 10);
}

export type SnapshotMode = 'live' | 'reconstructed';

export type SnapshotDayStats = {
  date: string;
  mode: SnapshotMode;
  rows: number;
  byScope: Record<string, number>;
  durationMs: number;
};

export type SnapshotStats = {
  days: SnapshotDayStats[];
  rows: number;
  durationMs: number;
};

export type SnapshotOptions = {
  /** Le jour photographié (défaut : aujourd'hui UTC). */
  date?: Date;
  /** Reconstruit chaque jour de cette date jusqu'à `date` inclus. */
  backfillFrom?: Date;
  /** L'instant « maintenant » (tests) : décide quel jour est `live`. */
  now?: Date;
};

type SnapshotRow = {
  key: string;
  activeJobs: number;
  newJobs: number;
  closedJobs: number;
  hiringCompanies: number;
  medianLifespanDays: number | null;
  reopenedJobs: number;
};

/** Un instant JS en `timestamp` UTC, comme Prisma écrit les colonnes `DateTime`. */
function utc(instant: Date): Prisma.Sql {
  return Prisma.sql`(${instant.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

/**
 * Le prédicat « active » du jour : la vérité (`isActive`) le jour même, la
 * reconstruction pour un jour passé (voir l'en-tête du module).
 */
function activePredicate(mode: SnapshotMode, end: Date): Prisma.Sql {
  if (mode === 'live') return Prisma.sql`j."isActive"`;
  const effectiveClose = Prisma.sql`COALESCE(j."closedAt", CASE WHEN j."isActive" THEN NULL ELSE j."lastSeenAt" END)`;
  return Prisma.sql`(j."firstSeenAt" < ${utc(end)} AND (${effectiveClose} IS NULL OR ${effectiveClose} >= ${utc(end)}))`;
}

/**
 * La CTE commune : une ligne par offre concernée par le jour (active, née,
 * fermée ou ré-ouverte ce jour-là), avec ses dimensions et ses drapeaux. Les
 * agrégats par périmètre se calculent tous dessus.
 */
function baseCte(mode: SnapshotMode, start: Date, end: Date): Prisma.Sql {
  const active = activePredicate(mode, end);
  const inDay = (column: Prisma.Sql) => Prisma.sql`(${column} >= ${utc(start)} AND ${column} < ${utc(end)})`;
  const isNew = inDay(Prisma.sql`j."firstSeenAt"`);
  const isClosed = Prisma.sql`(j."closedAt" IS NOT NULL AND ${inDay(Prisma.sql`j."closedAt"`)})`;
  return Prisma.sql`
    reopened AS (
      SELECT DISTINCT e."jobId"
      FROM "JobEvent" e
      WHERE e.type = 'REOPENED' AND ${inDay(Prisma.sql`e.at`)}
    ),
    base AS (
      SELECT
        j.id,
        j."companyId",
        j.country,
        j.city,
        c."parentGroup",
        c.sector::text AS sector,
        j."jobFunction",
        j.seniority,
        j.contract,
        j."isRetail",
        j."isAiRelated",
        ${active} AS active,
        ${isNew} AS is_new,
        ${isClosed} AS is_closed,
        CASE WHEN ${isClosed} THEN EXTRACT(EPOCH FROM (j."closedAt" - j."firstSeenAt")) / 86400.0 END AS lifespan_days,
        (r."jobId" IS NOT NULL) AS is_reopened
      FROM "Job" j
      JOIN "Company" c ON c.id = j."companyId"
      LEFT JOIN reopened r ON r."jobId" = j.id
      WHERE ${active} OR ${isNew} OR ${isClosed} OR r."jobId" IS NOT NULL
    )`;
}

/** L'expression SQL de la clé d'un périmètre (NULL = l'offre n'y appartient pas) et son seuil d'actives. */
const SCOPE_KEYS: Record<SnapshotScope, { key: Prisma.Sql; minActive: number }> = {
  global: { key: Prisma.sql`''`, minActive: 0 },
  country: { key: Prisma.sql`country`, minActive: 0 },
  city: { key: Prisma.sql`country || ${KEY_SEPARATOR} || city`, minActive: MIN_ACTIVE_FOR_CROSS },
  company: { key: Prisma.sql`"companyId"`, minActive: 1 },
  group: { key: Prisma.sql`"parentGroup"`, minActive: 0 },
  sector: { key: Prisma.sql`sector`, minActive: 0 },
  function: { key: Prisma.sql`COALESCE("jobFunction", ${UNCLASSIFIED_KEY})`, minActive: 0 },
  family: {
    key: Prisma.sql`CASE
      WHEN "jobFunction" IN (${Prisma.join([...CRAFT_FUNCTIONS])}) THEN 'craft'
      WHEN "isRetail" THEN 'retail'
      WHEN "isRetail" = false THEN 'corporate'
      ELSE ${UNCLASSIFIED_KEY} END`,
    minActive: 0,
  },
  seniority: { key: Prisma.sql`COALESCE(seniority, ${UNCLASSIFIED_KEY})`, minActive: 0 },
  contract: { key: Prisma.sql`COALESCE(contract, ${UNKNOWN_CONTRACT_KEY})`, minActive: 0 },
  ai: { key: Prisma.sql`CASE WHEN "isAiRelated" THEN 'true' END`, minActive: 0 },
  'country-function': {
    key: Prisma.sql`country || ${KEY_SEPARATOR} || COALESCE("jobFunction", ${UNCLASSIFIED_KEY})`,
    minActive: MIN_ACTIVE_FOR_CROSS,
  },
  'country-sector': { key: Prisma.sql`country || ${KEY_SEPARATOR} || sector`, minActive: MIN_ACTIVE_FOR_CROSS },
};

async function aggregateScope(
  prisma: PrismaClient,
  scope: SnapshotScope,
  base: Prisma.Sql,
): Promise<SnapshotRow[]> {
  const { key, minActive } = SCOPE_KEYS[scope];
  const rows = await prisma.$queryRaw<SnapshotRow[]>(Prisma.sql`
    WITH ${base}
    SELECT
      ${key} AS key,
      COUNT(*) FILTER (WHERE active)::int AS "activeJobs",
      COUNT(*) FILTER (WHERE is_new)::int AS "newJobs",
      COUNT(*) FILTER (WHERE is_closed)::int AS "closedJobs",
      COUNT(DISTINCT "companyId") FILTER (WHERE active)::int AS "hiringCompanies",
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY lifespan_days) FILTER (WHERE is_closed))::float AS "medianLifespanDays",
      COUNT(*) FILTER (WHERE is_reopened)::int AS "reopenedJobs"
    FROM base
    WHERE ${key} IS NOT NULL
    GROUP BY 1
    HAVING COUNT(*) FILTER (WHERE active) >= ${minActive}
  `);
  return rows;
}

async function snapshotDay(prisma: PrismaClient, day: Date, mode: SnapshotMode): Promise<SnapshotDayStats> {
  const startedAt = Date.now();
  const { start, end } = dayBounds(day);
  const base = baseCte(mode, start, end);

  const data: Prisma.MarketSnapshotCreateManyInput[] = [];
  const byScope: Record<string, number> = {};
  for (const scope of SNAPSHOT_SCOPES) {
    const rows = await aggregateScope(prisma, scope, base);
    byScope[scope] = rows.length;
    for (const row of rows) data.push({ date: day, scope, ...row });
  }

  // Idempotent : le jour est ré-écrit d'un bloc, jamais à moitié. Par
  // tranches (borne Postgres des paramètres liés), dans UNE transaction.
  await prisma.$transaction([
    prisma.marketSnapshot.deleteMany({ where: { date: day } }),
    ...chunk(data).map((batch) => prisma.marketSnapshot.createMany({ data: batch })),
  ]);

  return { date: formatDay(day), mode, rows: data.length, byScope, durationMs: Date.now() - startedAt };
}

export async function runSnapshot(prisma: PrismaClient, options: SnapshotOptions = {}): Promise<SnapshotStats> {
  const startedAt = Date.now();
  const today = dayBounds(options.now ?? new Date()).day;
  const target = dayBounds(options.date ?? today).day;
  if (target.getTime() > today.getTime()) throw new Error(`Cannot snapshot a future day (${formatDay(target)})`);

  const first = options.backfillFrom ? dayBounds(options.backfillFrom).day : target;
  if (first.getTime() > target.getTime()) {
    throw new Error(`--backfill-from (${formatDay(first)}) is after the target day (${formatDay(target)})`);
  }

  const days: SnapshotDayStats[] = [];
  for (let day = first; day.getTime() <= target.getTime(); day = new Date(day.getTime() + 86_400_000)) {
    const mode: SnapshotMode = day.getTime() === today.getTime() ? 'live' : 'reconstructed';
    days.push(await snapshotDay(prisma, day, mode));
  }

  return { days, rows: days.reduce((sum, d) => sum + d.rows, 0), durationMs: Date.now() - startedAt };
}
