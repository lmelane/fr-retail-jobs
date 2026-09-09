import { Prisma, type PrismaClient } from '@prisma/client';
import { chunk } from '../lib/chunk.js';

/**
 * Photographie quotidienne du marché (Catwalks Intelligence, D38).
 *
 * Une ligne `MarketSnapshot` par (jour, périmètre, clé) : le nombre d'offres
 * actives, nouvelles, fermées, le nombre de Maisons qui recrutent, la durée
 * de publication médiane des offres fermées ce jour-là, les ré-ouvertures.
 * Les comparaisons J-7 / J-30 / M-12 lisent cette table, jamais `Job` : les
 * offres se ferment ou sont retirées du catalogue, la photographie reste.
 *
 * Tout est agrégé en SQL (GROUP BY sur une CTE commune) : la base fait
 * 70 000 offres actives, on ne les charge jamais en mémoire. Idempotent :
 * rejouer un jour efface ses lignes et les ré-écrit dans une transaction.
 *
 * Deux modes, choisis par la date :
 *  - `live` (le jour même) : « active » = `Job.isActive`, la vérité du moment ;
 *  - `reconstructed` (un jour passé, `--backfill-from`) : « active au jour J »
 *    = `firstSeenAt` avant la fin de J et pas fermée avant la fin de J. C'est
 *    une RECONSTRUCTION approximative : les cycles de réouverture ne sont pas
 *    intégralement reconstruits, et avant le 2026-09-04 la base était
 *    reconstruite à chaque run (les `firstSeenAt` de cette époque sont ceux
 *    de la reconstruction, pas de la publication). Un retrait daté borne la
 *    présence au catalogue, sans compter comme fermeture. Une offre inactive
 *    sans date de fermeture/retrait ne prouve aucune période active passée.
 */

export const SNAPSHOT_SCOPES = [
  'global', 'country', 'city', 'company', 'group', 'sector', 'function', 'occupation', 'family',
  'seniority', 'employmentTerm', 'ai', 'country-function', 'country-sector',
] as const;
export type SnapshotScope = (typeof SNAPSHOT_SCOPES)[number];

/** Sépare les parties d'une clé composée : `FR|Paris`, `FR|retail-client-advisor`. */
export const KEY_SEPARATOR = '|';

/** Une ville, un croisement pays×métier ou pays×secteur n'existe qu'à partir de 5 offres actives. */
export const MIN_ACTIVE_FOR_CROSS = 5;

/** Les métiers de la famille « atelier » : `isRetail=false` couvre corporate ET craft, la fonction tranche. */


export const UNCLASSIFIED_KEY = 'unclassified';
/**
 * La clé du périmètre `employmentTerm` pour les offres dont la source ne dit
 * pas la durée. `null` ne peut pas servir de clé de regroupement, mais la
 * distinction reste lisible : « UNKNOWN » signifie « non renseigné », jamais
 * une valeur de la taxonomie.
 */
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
  /** Jour laissé intact : il porte une photographie `live`, qu'une reconstruction n'écrase jamais. */
  skippedLive?: boolean;
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
  const unavailableAt = Prisma.sql`COALESCE(j."closedAt", j."withdrawnAt")`;
  // An undated legacy inactive row cannot establish a historical live period.
  // Withdrawal ends catalogue availability without becoming a market closure.
  return Prisma.sql`(j."firstSeenAt" < ${utc(end)} AND (j."isActive" OR ${unavailableAt} >= ${utc(end)}))`;
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
  /**
   * Fermée ce jour-là : en `live`, l'événement CLOSED du jour — immuable, là
   * où `closedAt` est remis à null par une ré-ouverture (audit I-2 : rejouer
   * le jour après une ré-ouverture faisait passer closedJobs de 1 à 0). En
   * reconstruction, la date de fermeture enregistrée. Ni le dernier passage
   * ni un retrait du catalogue ne constitue une fermeture d'employeur.
   */
  const effectiveClose = Prisma.sql`j."closedAt"`;
  const isClosed =
    mode === 'live'
      ? Prisma.sql`(cl."jobId" IS NOT NULL)`
      : Prisma.sql`(${effectiveClose} IS NOT NULL AND ${inDay(effectiveClose)})`;
  const closeInstant = mode === 'live' ? Prisma.sql`cl.closed_at` : effectiveClose;
  return Prisma.sql`
    reopened AS (
      SELECT DISTINCT e."jobId"
      FROM "JobEvent" e
      WHERE e.type = 'REOPENED' AND ${inDay(Prisma.sql`e.at`)}
    ),
    closed_events AS (
      SELECT e."jobId", MAX(e.at) AS closed_at
      FROM "JobEvent" e
      WHERE e.type = 'CLOSED' AND ${inDay(Prisma.sql`e.at`)}
      GROUP BY e."jobId"
    ),
    base AS (
      SELECT
        j.id,
        j."companyId",
        -- La colonne se nomme countryCode ; la DIMENSION statistique se nomme
        -- country, et elle doit le rester : MarketSnapshot.scope porte cette
        -- valeur sur des milliers de lignes d historique. Renommer la dimension
        -- pour suivre un nom technique casserait la comparaison avec les
        -- photographies deja prises. L alias tient les deux.
        j."countryCode" AS country,
        j.city,
        c."parentGroup",
        c."sectorCodes",
        j."jobFunction",
        j."occupationCode",
        j."occupationGroup",
        j.seniority,
        j."employmentTerm",
        j."isRetail",
        j."isAiRelated",
        ${active} AS active,
        ${isNew} AS is_new,
        ${isClosed} AS is_closed,
        CASE WHEN ${isClosed} THEN EXTRACT(EPOCH FROM (${closeInstant} - j."firstSeenAt")) / 86400.0 END AS lifespan_days,
        (r."jobId" IS NOT NULL) AS is_reopened
      FROM "Job" j
      JOIN "Company" c ON c.id = j."companyId"
      LEFT JOIN reopened r ON r."jobId" = j.id
      LEFT JOIN closed_events cl ON cl."jobId" = j.id
      -- Preserved aliases are not another opening or a source closure. Never
      -- turn their lastSeenAt into a synthetic closedAt during reconstruction.
      WHERE j."mergedIntoId" IS NULL AND (${active} OR ${isNew} OR ${isClosed} OR r."jobId" IS NOT NULL)
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
  occupation: {key:Prisma.sql`COALESCE("occupationCode", ${UNCLASSIFIED_KEY})`,minActive:0},
  family: {key:Prisma.sql`COALESCE("occupationGroup", ${UNCLASSIFIED_KEY})`,minActive:0},
  seniority: { key: Prisma.sql`COALESCE(seniority, ${UNCLASSIFIED_KEY})`, minActive: 0 },
  employmentTerm: { key: Prisma.sql`COALESCE("employmentTerm", ${UNKNOWN_CONTRACT_KEY})`, minActive: 0 },
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
    FROM base ${scope==='sector'||scope==='country-sector'?Prisma.sql`CROSS JOIN LATERAL unnest(CASE WHEN cardinality("sectorCodes")=0 THEN ARRAY['unclassified'] ELSE "sectorCodes" END) sector`:Prisma.empty}
    WHERE ${key} IS NOT NULL
    GROUP BY 1
    HAVING COUNT(*) FILTER (WHERE active) >= ${minActive}
  `);
  return rows;
}

async function snapshotDay(prisma: PrismaClient, day: Date, mode: SnapshotMode): Promise<SnapshotDayStats> {
  const startedAt = Date.now();
  const { start, end } = dayBounds(day);

  // Une photographie prise le jour même est la vérité de ce jour : une
  // reconstruction (depuis l'état ACTUEL des offres) ne la remplace jamais
  // (audit I-2 : un backfill rejoué changeait la société d'hier, retirait
  // les offres supprimées depuis, effaçait les fermetures ré-ouvertes).
  if (mode === 'reconstructed') {
    const live = await prisma.marketSnapshot.count({ where: { date: day, mode: 'live' } });
    if (live > 0) {
      return { date: formatDay(day), mode, rows: 0, byScope: {}, durationMs: Date.now() - startedAt, skippedLive: true };
    }
  }
  const base = baseCte(mode, start, end);

  const data: Prisma.MarketSnapshotCreateManyInput[] = [];
  const byScope: Record<string, number> = {};
  for (const scope of SNAPSHOT_SCOPES) {
    const rows = await aggregateScope(prisma, scope, base);
    byScope[scope] = rows.length;
    for (const row of rows) data.push({ date: day, scope, mode, ...row });
  }

  // Idempotent : le jour est ré-écrit d'un bloc, jamais à moitié (un `live`
  // rejoué le même jour remplace le `live` précédent : c'est le même jour, vu
  // plus tard). Par tranches (borne Postgres des paramètres liés), dans UNE
  // transaction.
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
