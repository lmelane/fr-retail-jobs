import { getOccupationPresentation } from '@/lib/occupations';
import { prisma, Prisma } from '@catwalks/db';
import { DatabaseUnavailableError } from '@/lib/jobs';
import { cached } from '../cache';
import { byContract, byFunction, bySeniority, closedFacts, headline, toFamilies, type Count, type Headline, type ClosedFacts } from '../facts';
import { series } from '../snapshots';
import type { SnapshotPoint } from '../metrics';
import type { JobFamily } from '../taxonomy';

/**
 * Global Hiring Pulse (`/intelligence/marche`) : par fenêtre (7 j, 30 j, 3 m,
 * 6 m, 12 m) — nouvelles et fermées LUES dans Job (faits, bornés à l'ancienneté
 * réelle de l'historique), variation des actives et Maisons LUES dans les
 * snapshots (n/d daté tant que le point n'existe pas).
 */
export const WINDOWS = [
  { key: '7j', label: '7 jours', days: 7 },
  { key: '30j', label: '30 jours', days: 30 },
  { key: '3m', label: '3 mois', days: 90 },
  { key: '6m', label: '6 mois', days: 180 },
  { key: '12m', label: '12 mois', days: 365 },
] as const;

export type WindowFacts = { key: string; days: number; opened: number; closed: number };

export type MarketData = {
  headline: Headline;
  closed: ClosedFacts;
  windows: WindowFacts[];
  global: SnapshotPoint[];
  contracts: Count[];
  seniority: Count[];
  families: { key: JobFamily | ''; count: number }[];
  sectorSeries: { key: string; series: SnapshotPoint[] }[];
  /** Séries `family` dans l'ordre retail, corporate, craft. */
  familySeries: { key: JobFamily; series: SnapshotPoint[] }[];
};

async function windowFacts(): Promise<WindowFacts[]> {
  if (!process.env.DATABASE_URL) throw new DatabaseUnavailableError();
  try {
    const rows = await prisma.$queryRaw<{ days: number; opened: number; closed: number }[]>(Prisma.sql`
      SELECT w.days,
        (SELECT count(*)::int FROM "Job" WHERE "mergedIntoId" IS NULL AND "firstSeenAt" >= now() - (w.days || ' days')::interval) AS "opened",
        (SELECT count(*)::int FROM "Job" WHERE "mergedIntoId" IS NULL AND "closedAt" IS NOT NULL AND NOT "isActive" AND "closedAt" >= now() - (w.days || ' days')::interval) AS "closed"
      FROM (VALUES ${Prisma.join(WINDOWS.map((w) => Prisma.sql`(${w.days}::int)`))}) AS w(days) ORDER BY w.days`);
    return WINDOWS.map((w) => {
      const r = rows.find((x) => x.days === w.days);
      return { key: w.key, days: w.days, opened: r?.opened ?? 0, closed: r?.closed ?? 0 };
    });
  } catch (error) {
    throw new DatabaseUnavailableError(error);
  }
}

const SECTOR_KEYS = ['FASHION', 'LUXURY', 'BEAUTY', 'JEWELRY_WATCHES', 'RETAIL'];

export const getMarket = cached('market', async (): Promise<MarketData> => {
  const {FAMILY_LABELS}=await getOccupationPresentation();
  const FAMILY_KEYS=Object.keys(FAMILY_LABELS);
  const [h, closed, windows, global, contracts, seniority, functions, ...rest] = await Promise.all([
    headline(),
    closedFacts(),
    windowFacts(),
    series('global', '', 400),
    byContract(),
    bySeniority(),
    byFunction(),
    ...SECTOR_KEYS.map((k) => series('sector', k, 400)),
    ...FAMILY_KEYS.map((k) => series('family', k, 400)),
  ]);
  const sectorSeries = rest.slice(0, SECTOR_KEYS.length);
  const familySeries = rest.slice(SECTOR_KEYS.length);
  return {
    headline: h,
    closed,
    windows,
    global,
    contracts,
    seniority,
    families: await toFamilies(functions),
    sectorSeries: SECTOR_KEYS.map((key, i) => ({ key, series: sectorSeries[i] })),
    familySeries: FAMILY_KEYS.map((key, i) => ({ key, series: familySeries[i] })),
  };
});
