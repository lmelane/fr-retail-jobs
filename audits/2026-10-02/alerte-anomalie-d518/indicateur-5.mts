/**
 * Indicateur 5 de la boucle (délai jusqu'au prochain envoi d'alertes), avant et après le correctif D-498 : le même
 * ensemble d'offres, au calendrier de Paris pour tous (avant) et au calendrier de leur marché (après). Lecture seule de la
 * production, dans une transaction READ ONLY ; rien n'est écrit. Hors fenêtre du RUN (jamais entre 15:30 et 18:30 UTC).
 *
 *   python3 <checkout qui porte les accès>/apps/aggregator/scripts/ops/db.py readonly \
 *     npx tsx audits/2026-10-02/alerte-anomalie-d518/indicateur-5.mts > audits/2026-10-02/alerte-anomalie-d518/indicateur-5.json
 *
 * Avant r6, la production n'a pas `JobSource.availabilityHold` : le seul prédicat qui la lit est retiré du texte de la
 * requête, comme `../boucle-couverture/bulletin-exemple.mts`.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { publicJobSql } from '@catwalks/db/availability';
import { marketOf } from '../../../apps/aggregator/src/coverage/coverageReading.js';
import { nextAlertSlot, percentile } from '../../../apps/aggregator/src/coverage/loopIndicators.js';

const prisma = new PrismaClient();
try {
  const at = new Date();
  const j = Prisma.raw('j');
  const HOLD = /\s*AND available_source\."availabilityHold" IS NULL/g;
  const query = Prisma.sql`SELECT j."firstSeenAt", j."countryCode" FROM "Job" j WHERE ${publicJobSql(j, at)} AND j."countryCode" IS NOT NULL
    AND j."firstSeenAt" > ${new Date(at.getTime() - 86_400_000)} AND j."firstSeenAt" <= ${at}`;
  const rows = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return tx.$queryRaw<Array<{ firstSeenAt: Date; countryCode: string }>>(Prisma.sql(query.strings.map(part => part.replace(HOLD, '')), ...query.values));
  }, { isolationLevel: 'RepeatableRead', timeout: 60_000, maxWait: 10_000 });
  const hours = (slot: (r: { firstSeenAt: Date; countryCode: string }) => Date) => rows.map(r => (slot(r).getTime() - r.firstSeenAt.getTime()) / 3_600_000);
  const before = hours(r => nextAlertSlot(r.firstSeenAt, 'FR')), after = hours(r => nextAlertSlot(r.firstSeenAt, marketOf(r.countryCode)));
  const round = (v: number | null) => v == null ? null : Math.round(v * 10) / 10;
  const byMarket = new Map<string, number[]>();
  rows.forEach((r, i) => { const m = marketOf(r.countryCode) ?? 'hors marché'; byMarket.set(m, [...(byMarket.get(m) ?? []), after[i] - before[i]]); });
  console.log(JSON.stringify({ at, offres: rows.length, horsMarche: rows.filter(r => !marketOf(r.countryCode)).length,
    avantParis: { mediane: round(percentile(before, 0.5)), p90: round(percentile(before, 0.9)) },
    apresMarche: { mediane: round(percentile(after, 0.5)), p90: round(percentile(after, 0.9)) },
    ecartMedianParMarche: Object.fromEntries([...byMarket.entries()].sort((a, b) => b[1].length - a[1].length)
      .map(([m, d]) => [m, { offres: d.length, ecartMedianHeures: round(percentile(d, 0.5)) }])) }, null, 1));
} finally {
  await prisma.$disconnect();
}
