/**
 * LES INDICATEURS DE LA BOUCLE CANDIDAT — R-143 §9, §11 ; D-515 §4 (les sept questions du CEO, 02/10/2026).
 *
 * Un indicateur par question, quand il est mesurable aujourd'hui ; chacun porte sa définition et son dénominateur, et
 * se rejoue par `coverage` (lecture seule). Ce qui est déjà calculé est relu, pas recalculé : la sonde du RUN
 * (`applyLinkProbe.ts`), le rapport de santé (`healthReport.ts`), et la photographie de couverture.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { publicJobSql } from '@catwalks/db/availability';
import { buildHealthReport } from '../pipeline/healthReport.js';
import { marketOf } from './coverageReading.js';
import { share } from './reporting.js';

type Db = Prisma.TransactionClient | PrismaClient;
export type Indicator = { question: number; title: string; value: string; definition: string; denominator: string; measured: boolean };
export type ProbeSummary = { probed: number; byVerdict: Record<string, number> };

const NUMBER = new Intl.NumberFormat('fr-FR');
const hours = (h: number | null) => h == null ? 'n/d' : `${NUMBER.format(Math.round(h * 10) / 10)} h`;

export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * p, low = Math.floor(rank), high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/**
 * LE CALENDRIER DES ALERTES PAR MARCHÉ (D-498, R-130 §1) : 07:30 à l'heure locale du marché, le mardi et le vendredi,
 * le mardi et le jeudi en Arabie saoudite. Recopié de `catwalks-backend/src/lib/alertes/marches.ts` (`MARCHES_ALERTES`),
 * qui en est la source : le registre des marchés (`packages/db/marches.ts`) ne porte pas de fuseau. Un marché qui couvre
 * plusieurs fuseaux prend celui de sa capitale économique, comme le moteur. Le témoin fige un fuseau pour chaque marché.
 */
const TUE_FRI = [2, 5] as const, TUE_THU = [2, 4] as const;
export const ALERT_CALENDAR: Readonly<Record<string, { timeZone: string; days: readonly number[] }>> = {
  JP: { timeZone: 'Asia/Tokyo', days: TUE_FRI }, KR: { timeZone: 'Asia/Seoul', days: TUE_FRI },
  PT: { timeZone: 'Europe/Lisbon', days: TUE_FRI }, MX: { timeZone: 'America/Mexico_City', days: TUE_FRI },
  SG: { timeZone: 'Asia/Singapore', days: TUE_FRI }, DK: { timeZone: 'Europe/Copenhagen', days: TUE_FRI },
  HK: { timeZone: 'Asia/Hong_Kong', days: TUE_FRI }, PL: { timeZone: 'Europe/Warsaw', days: TUE_FRI },
  SE: { timeZone: 'Europe/Stockholm', days: TUE_FRI }, CL: { timeZone: 'America/Santiago', days: TUE_FRI },
  TR: { timeZone: 'Europe/Istanbul', days: TUE_FRI }, TH: { timeZone: 'Asia/Bangkok', days: TUE_FRI },
  MY: { timeZone: 'Asia/Kuala_Lumpur', days: TUE_FRI }, AE: { timeZone: 'Asia/Dubai', days: TUE_FRI },
  NO: { timeZone: 'Europe/Oslo', days: TUE_FRI }, TW: { timeZone: 'Asia/Taipei', days: TUE_FRI },
  BR: { timeZone: 'America/Sao_Paulo', days: TUE_FRI }, GR: { timeZone: 'Europe/Athens', days: TUE_FRI },
  ZA: { timeZone: 'Africa/Johannesburg', days: TUE_FRI }, VN: { timeZone: 'Asia/Ho_Chi_Minh', days: TUE_FRI },
  CZ: { timeZone: 'Europe/Prague', days: TUE_FRI }, PE: { timeZone: 'America/Lima', days: TUE_FRI },
  NZ: { timeZone: 'Pacific/Auckland', days: TUE_FRI }, HU: { timeZone: 'Europe/Budapest', days: TUE_FRI },
  SA: { timeZone: 'Asia/Riyadh', days: TUE_THU }, RO: { timeZone: 'Europe/Bucharest', days: TUE_FRI },
  PR: { timeZone: 'America/Puerto_Rico', days: TUE_FRI }, PH: { timeZone: 'Asia/Manila', days: TUE_FRI },
  LU: { timeZone: 'Europe/Luxembourg', days: TUE_FRI }, US: { timeZone: 'America/New_York', days: TUE_FRI },
  FR: { timeZone: 'Europe/Paris', days: TUE_FRI }, GB: { timeZone: 'Europe/London', days: TUE_FRI },
  CA: { timeZone: 'America/Toronto', days: TUE_FRI }, DE: { timeZone: 'Europe/Berlin', days: TUE_FRI },
  IT: { timeZone: 'Europe/Rome', days: TUE_FRI }, ES: { timeZone: 'Europe/Madrid', days: TUE_FRI },
  NL: { timeZone: 'Europe/Amsterdam', days: TUE_FRI }, AU: { timeZone: 'Australia/Sydney', days: TUE_FRI },
  CH: { timeZone: 'Europe/Zurich', days: TUE_FRI }, BE: { timeZone: 'Europe/Brussels', days: TUE_FRI },
  CN: { timeZone: 'Asia/Shanghai', days: TUE_FRI },
};
/** Le marché d'un inscrit sans marché connu, comme le moteur (`MARCHE_PAR_DEFAUT`). */
export const DEFAULT_ALERT_MARKET = 'FR';

/** Décalage d'un fuseau à un instant, en minutes (« GMT+2 » -> 120, « GMT-4 » -> -240). */
function offsetMinutes(at: Date, timeZone: string): number {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(at).find(p => p.type === 'timeZoneName')?.value ?? 'GMT';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
  return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0)) : 0;
}

/**
 * Le prochain envoi d'alertes après `at` pour un marché : 07:30 à l'heure locale du marché, un de ses jours d'envoi
 * (D-498). Un marché inconnu prend celui du moteur par défaut.
 */
export function nextAlertSlot(at: Date, market: string | null = DEFAULT_ALERT_MARKET): Date {
  const { timeZone, days } = ALERT_CALENDAR[market ?? DEFAULT_ALERT_MARKET] ?? ALERT_CALENDAR[DEFAULT_ALERT_MARKET];
  for (let day = 0; day <= 7; day++) {
    const probe = new Date(at.getTime() + day * 86_400_000);
    const local = new Date(probe.getTime() + offsetMinutes(probe, timeZone) * 60_000);
    if (!days.includes(local.getUTCDay())) continue;
    const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 7, 30);
    const slot = new Date(guess - offsetMinutes(new Date(guess), timeZone) * 60_000);
    if (slot.getTime() >= at.getTime()) return slot;
  }
  throw new Error('no alert slot within a week');
}

async function discovery(db: Db, at: Date): Promise<Indicator> {
  const since = new Date(at.getTime() - 7 * 86_400_000);
  const [row] = await db.$queryRaw<Array<{ n: number; measurable: number; dayOnly: number; median: number | null; p90: number | null }>>`
    WITH anciennete AS (SELECT "sourceKey", min("firstSeenAt") AS premiere FROM "JobSource" GROUP BY 1),
    nouvelles AS (
      SELECT extract(epoch FROM (j."firstSeenAt" - j."postedAt")) / 3600 AS h, j."postedAt" = date_trunc('day', j."postedAt") AS jour
      FROM "Job" j JOIN anciennete a ON a."sourceKey" = j."canonicalSourceKey"
      WHERE a.premiere < ${since} AND j."firstSeenAt" >= ${since} AND j."firstSeenAt" <= ${at} AND j."postedAt" IS NOT NULL)
    SELECT count(*)::int AS n, count(*) FILTER (WHERE h >= 0)::int AS measurable, count(*) FILTER (WHERE h >= 0 AND jour)::int AS "dayOnly",
      (percentile_cont(0.5) WITHIN GROUP (ORDER BY h) FILTER (WHERE h >= 0))::float AS median,
      (percentile_cont(0.9) WITHIN GROUP (ORDER BY h) FILTER (WHERE h >= 0))::float AS p90 FROM nouvelles`;
  return { question: 1, title: 'Délai de découverte', measured: row.measurable > 0,
    value: `médiane ${hours(row.median)}, p90 ${hours(row.p90)}`,
    definition: 'Heures entre la date de publication déclarée par la source et notre première observation, pour les offres vues pour la première fois ces 7 derniers jours chez une source déjà collectée avant. Une date au jour seul compte depuis minuit : le délai réel est surestimé pour elles.',
    denominator: `${NUMBER.format(row.measurable)} offres datées (dont ${NUMBER.format(row.dayOnly)} au jour seul ; ${NUMBER.format(row.n - row.measurable)} écartées, date postérieure à l'observation)` };
}

async function duplicates(db: Db, at: Date): Promise<Indicator> {
  const j = Prisma.raw('j');
  const [row] = await db.$queryRaw<Array<{ served: number; groups: number; extra: number }>>(Prisma.sql`
    WITH servie AS (SELECT j.* FROM "Job" j WHERE ${publicJobSql(j, at)} AND j."countryCode" IS NOT NULL),
    k AS (SELECT "companyId", "canonicalSourceKey" AS src,
      lower(regexp_replace(translate(lower(title), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ', 'aaaaaaceeeeiiiinooooouuuuyyoa'), '[^a-z0-9]+', ' ', 'g')) AS t,
      lower(coalesce(city, '')) AS c FROM servie),
    g AS (SELECT count(*) AS n FROM k WHERE c <> '' GROUP BY "companyId", t, c HAVING count(DISTINCT src) > 1)
    SELECT (SELECT count(*) FROM servie)::int AS served, (SELECT count(*) FROM g)::int AS groups, (SELECT coalesce(sum(n - 1), 0) FROM g)::int AS extra`);
  return { question: 2, title: 'Doublons servis', measured: true,
    value: `${NUMBER.format(row.groups)} groupes, ${share(row.extra, row.served)} des offres en trop`,
    definition: 'Groupes d’offres servies de la même Maison, au même intitulé normalisé et dans la même ville, publiées par des sources différentes ; « en trop » compte toutes les offres d’un groupe sauf une, si tous sont de vrais doublons (majorant).',
    denominator: `${NUMBER.format(row.served)} offres servies` };
}

async function attachment(db: Db, at: Date): Promise<Indicator> {
  const j = Prisma.raw('j');
  const [row] = await db.$queryRaw<Array<{ served: number; metier: number; contrat: number; lieu: number }>>(Prisma.sql`
    SELECT count(*)::int AS served,
      count(*) FILTER (WHERE j."occupationCode" IS NOT NULL OR cardinality(j."titleRoles") > 0)::int AS metier,
      count(*) FILTER (WHERE j."employmentTerm" IS NOT NULL OR j."programType" IS NOT NULL OR j."engagementType" IS NOT NULL)::int AS contrat,
      count(*) FILTER (WHERE j."geoLatitude" IS NOT NULL)::int AS lieu
    FROM "Job" j WHERE ${publicJobSql(j, at)} AND j."countryCode" IS NOT NULL`);
  return { question: 3, title: 'Rattachement : métier, contrat, lieu', measured: true,
    value: `métier ${share(row.metier, row.served)} ; contrat ${share(row.contrat, row.served)} ; lieu ${share(row.lieu, row.served)}`,
    definition: 'Part des offres servies qui portent un métier (code du référentiel ou rôle lu dans l’intitulé), une nature d’emploi reconnue (contrat, dispositif ou indépendant) et un point de recherche de proximité. La Maison n’est pas mesurée ici : les entités juridiques à rattacher se comptent par l’aperçu `attach-maisons`.',
    denominator: `${NUMBER.format(row.served)} offres servies` };
}

async function alertDelay(db: Db, at: Date): Promise<Indicator> {
  const j = Prisma.raw('j');
  const rows = await db.$queryRaw<Array<{ firstSeenAt: Date; countryCode: string }>>(Prisma.sql`
    SELECT j."firstSeenAt", j."countryCode" FROM "Job" j WHERE ${publicJobSql(j, at)} AND j."countryCode" IS NOT NULL
      AND j."firstSeenAt" > ${new Date(at.getTime() - 86_400_000)} AND j."firstSeenAt" <= ${at}`);
  const delays = rows.map(r => (nextAlertSlot(r.firstSeenAt, marketOf(r.countryCode)).getTime() - r.firstSeenAt.getTime()) / 3_600_000);
  const outside = rows.filter(r => !marketOf(r.countryCode)).length;
  return { question: 5, title: 'Alertes : délai jusqu’à l’envoi', measured: delays.length > 0,
    value: `médiane ${hours(percentile(delays, 0.5))}, p90 ${hours(percentile(delays, 0.9))} ; prochain envoi en France ${nextAlertSlot(at, 'FR').toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    definition: 'Heures entre la première observation d’une offre servie et le prochain envoi d’alertes de son marché, à 07:30 heure locale du marché, le mardi et le vendredi (le mardi et le jeudi en Arabie saoudite ; D-498). Délai du calendrier seulement : les envois réels vivent dans le backend, hors de cette base.',
    denominator: `${NUMBER.format(delays.length)} offres servies vues pour la première fois dans les 24 dernières heures${outside ? ` (dont ${NUMBER.format(outside)} hors marché ouvert, au calendrier de la France)` : ''}` };
}

async function confidence(db: Db, at: Date, probe: ProbeSummary | null, prisma: PrismaClient | null): Promise<Indicator> {
  const j = Prisma.raw('j');
  const [row] = await db.$queryRaw<Array<{ servable: number; masked: number }>>(Prisma.sql`
    SELECT count(*)::int AS servable, count(*) FILTER (WHERE NOT (${publicJobSql(j, at)}))::int AS masked
    FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL AND j."countryCode" IS NOT NULL
      AND EXISTS (SELECT 1 FROM "JobSource" js WHERE js."jobId" = j.id AND js."isActive" AND (js."expiresAt" IS NULL OR js."expiresAt" > ${at}))`);
  const health = prisma ? (await buildHealthReport(prisma, at)).totals : null;
  const probeText = probe ? `sonde : ${NUMBER.format(probe.probed)} liens lus, ${NUMBER.format(probe.byVerdict.DEAD ?? 0)} morts, ${NUMBER.format(probe.byVerdict.OPEN ?? 0)} ouverts, ${NUMBER.format((probe.byVerdict.NON_CONCLUSIVE ?? 0) + (probe.byVerdict.TECHNICAL ?? 0))} non concluants`
    : 'sonde : non lue hors RUN';
  const fresh = health ? `non revues depuis 48 h : ${share(health.withoutFreshSource, health.activeJobs)}` : 'non revues : non lu';
  return { question: 6, title: 'Confiance au clic', measured: true,
    value: `masquées ${share(row.masked, row.servable)} ; ${probeText} ; ${fresh}`,
    definition: 'Masquées : offres disponibles à la source mais retirées de l’expérience candidat par la retenue de disponibilité (R-143 §2). Sonde : les liens « Postuler » lus par ce RUN. Non revues : offres actives dont aucune source n’a été revue depuis 48 h (rapport de santé, `health-report`).',
    denominator: `${NUMBER.format(row.servable)} offres disponibles à la source (masquées) ; offres actives du rapport de santé (non revues)` };
}

const RANKING: Indicator = { question: 4, title: 'Classement par préférences', measured: false,
  value: 'non mesuré par le bulletin : le classement pertinent de R-143 §7 est sur development, sans indicateur de pertinence',
  definition: 'Part des recherches avec requête ou préférences où l’offre qui correspond le mieux passe devant les moins pertinentes.',
  denominator: 'aucun' };

/** Les indicateurs 1 à 6 ; le 7 (couverture) vient de l'alerte elle-même. `prisma` sert au rapport de santé. */
export async function readLoopIndicators(db: Db, input: { at: Date; probe: ProbeSummary | null; prisma: PrismaClient | null }): Promise<Indicator[]> {
  return [await discovery(db, input.at), await duplicates(db, input.at), await attachment(db, input.at), RANKING,
    await alertDelay(db, input.at), await confidence(db, input.at, input.probe, input.prisma)];
}
