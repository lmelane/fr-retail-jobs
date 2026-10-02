/**
 * Le coût réel de la lecture de la revue de couverture (`readCoverageState`) et des indicateurs sur la production, en
 * LECTURE SEULE (transaction `READ ONLY`, instantané répétable), et la cohérence de ce qu'elle lit avec le rejeu.
 *
 *   python3 apps/aggregator/scripts/ops/db.py readonly npx tsx audits/2026-10-02/boucle-couverture/mesure-cout.mts
 *
 * AVANT r6, la production n'a pas les colonnes de retenue (`availabilityHold`, `availabilityHoldAt`,
 * `availabilityEvidence`, migration `20261002140000`) : leur lecture est remplacée par NULL dans le texte des requêtes,
 * ce qu'elles vaudront partout avant la première revue de disponibilité. Rien d'autre n'est réécrit. Les sorties par
 * cause sont lues sur 7 jours (`since`), comme la fenêtre de référence ; les menaces depuis le début du RUN du 01/10
 * (16:03 UTC) : avant r6, elles comptent aussi les offres que la première revue masquera (H&M, Primark…).
 */
import { writeFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import { readCoverageBefore, readCoverageState } from '../../../apps/aggregator/src/coverage/coverageReading.js';
import { readLoopIndicators } from '../../../apps/aggregator/src/coverage/loopIndicators.js';

const prisma = new PrismaClient();
const PRE_R6: Array<[RegExp, string]> = [
  [/\s*AND available_source\."availabilityHold" IS NULL/g, ''],
  [/js\."availabilityHold"/g, 'NULL::text'],
  [/js\."availabilityHoldAt"/g, 'NULL::timestamp'],
  [/js\."availabilityEvidence"/g, 'NULL::jsonb'],
];
const preR6 = <T extends object>(db: T): T => new Proxy(db, { get(target: any, prop, receiver) {
  if (prop !== '$queryRaw') return Reflect.get(target, prop, receiver);
  return (first: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
    const sql = 'raw' in first ? Prisma.sql(first, ...values) : first;
    return target.$queryRaw(Prisma.sql(sql.strings.map(part => PRE_R6.reduce((s, [re, by]) => s.replace(re, by), part)), ...sql.values));
  };
} });

try {
  const at = new Date(), since = new Date(at.getTime() - 7 * 86_400_000);
  const timings: Record<string, number> = {};
  const state = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const started = Date.now();
    const before = await readCoverageBefore(preR6(tx), at);
    timings.readCoverageBefore_ms = Date.now() - started;
    const result = await readCoverageState(preR6(tx), { at, before, runStartedAt: new Date('2026-10-01T16:03:18.104Z'),
      horizons: { RUN: at, LAST: new Date('2026-10-01T18:25:37.917Z'), WINDOW: since } });
    timings.readCoverageState_ms = Date.now() - started;
    return result;
  }, { isolationLevel: 'RepeatableRead', timeout: 300_000, maxWait: 10_000 });
  const startedIndicators = Date.now();
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return readLoopIndicators(preR6(tx), { at, probe: null, prisma });
  }, { isolationLevel: 'RepeatableRead', timeout: 300_000, maxWait: 10_000 });
  timings.readLoopIndicators_ms = Date.now() - startedIndicators;
  const maisons = state.entities.filter(e => e.scope === 'MAISON'), marches = state.entities.filter(e => e.scope === 'MARCHE');
  const summary = { at, since, timings,
    served: maisons.reduce((s, e) => s + e.served, 0), maisons: maisons.length, marches: marches.length,
    exitsWindow: Object.fromEntries(['FERMETURE_SOURCE', 'RETENUE_REGLE', 'PAUSE_DECIDEE', 'NON_REVUE', 'COLLECTE', 'LIEN_MORT', 'REGROUPEE']
      .map(c => [c, maisons.reduce((s, e) => s + (e.exits.WINDOW.counts[c as keyof typeof e.exits.WINDOW.counts] ?? 0), 0)])),
    threatsSinceRun_b4e6b708: maisons.flatMap(e => e.threat.sources.map(s => ({ maison: e.label, ...s }))).sort((a, b) => b.count - a.count).slice(0, 12),
    masked: state.masked.total,
    knownSources: state.knownSources.filter(s => s.served === 0) };
  writeFileSync(new URL('./mesure-cout.json', import.meta.url), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
} finally {
  await prisma.$disconnect();
}
