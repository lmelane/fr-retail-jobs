/**
 * LA REVUE DE COUVERTURE — R-143 §11, D-515 §5, D-516 §2.
 *
 * Dans le RUN (`cli.ts`, `ingest-all`), l'avant est lu juste avant le refresh, la revue de disponibilité et la sonde ;
 * la revue tourne juste après elles et envoie le bulletin. Les commandes `availability` et `probe-apply-links`, qui
 * posent aussi des retenues, font de même : aucun masquage ne part sans le bulletin qui dit ce qu'il retire.
 *
 * Ce que le candidat voit avant nous : les retenues sont écrites source par source et lues en direct par la recherche ;
 * le bulletin part quelques minutes après (le temps de la sonde, 10 min au plus). Ce qui se sait AVANT le candidat, ce
 * sont les MENACES : une offre qu'aucune collecte du RUN n'a revue est signalée dès ce RUN, de 24 à 48 h avant que le
 * plafond de 72 h ne la masque.
 *
 * `dryRun` (commande `coverage`) lit tout, n'écrit aucune photographie, n'envoie rien.
 */
import type { PrismaClient } from '@prisma/client';
import { sendOperatorEmail } from '../pipeline/alert.js';
import { evaluateCoverage, newAlerts, referenceWindow, type CoverageEvaluation } from './coverageAlert.js';
import { bulletinHtml, bulletinSubject, type RegistryReading } from './coverageBulletin.js';
import { ambiguousSources, readRegistrySources } from '../registry/explicitRegistry.js';
import { readCoverageBefore, readCoverageHistory, readCoverageState, writeCoverageSnapshot, type CoverageBefore, type MaskedStock } from './coverageReading.js';
import { readLoopIndicators, type Indicator, type ProbeSummary } from './loopIndicators.js';
import { readExposureDistribution, type ExposureDistribution } from './offerExposureReading.js';
import { log } from '../observability/logger.js';

export type CoverageReview = { at: Date; evaluation: CoverageEvaluation; indicators: Indicator[]; masked: MaskedStock;
  registry: RegistryReading;
  /** D-520 §3 : la répartition des offres par état d'exposition, au même instant ; null si elle n'a pu être lue (dit au bulletin). */
  exposure: ExposureDistribution | null;
  written: number; sent: boolean; dryRun: boolean };

/**
 * D-520 §2 : les sources hors service sans explication, à l'explication périmée, ou dont la date de réexamen est passée
 * (`ambiguousSources`), lues à chaque RUN et dites dans le bulletin. Une lecture impossible se dit aussi.
 */
async function readRegistry(prisma: PrismaClient, at: Date): Promise<RegistryReading> {
  try {
    return { ambiguous: ambiguousSources(await readRegistrySources(prisma), at.toISOString().slice(0, 10)) };
  } catch (error) {
    return { error: error instanceof Error ? error.message.split('\n')[0].slice(0, 200) : 'lecture impossible' };
  }
}

/** Le lien vers la source : son site carrières quand le registre le connaît. */
async function sourceLinks(prisma: PrismaClient, evaluation: CoverageEvaluation): Promise<void> {
  const keys = [...new Set(evaluation.findings.flatMap(f => f.sources.map(s => s.sourceKey)))];
  if (!keys.length) return;
  const rows = await prisma.source.findMany({ where: { key: { in: keys } }, select: { key: true, careersDomain: true } });
  const url = new Map(rows.filter(r => r.careersDomain).map(r => [r.key, `https://${r.careersDomain}`]));
  for (const finding of evaluation.findings) for (const source of finding.sources) source.url = url.get(source.sourceKey) ?? null;
}

/** Le début du RUN : celui-ci quand il est connu, sinon le dernier RUN quotidien (une offre non revue depuis est menacée). */
async function runStartedAt(prisma: PrismaClient, runId: string | null): Promise<Date | null> {
  const run = runId ? await prisma.pipelineRun.findUnique({ where: { id: runId }, select: { startedAt: true, command: true } }) : null;
  if (run?.command === 'ingest-all') return run.startedAt;
  return (await prisma.pipelineRun.findFirst({ where: { command: 'ingest-all' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }))?.startedAt ?? null;
}

export async function runCoverageReview(prisma: PrismaClient, options: { runId?: string | null; probe?: ProbeSummary | null;
  before?: CoverageBefore | null; dryRun?: boolean } = {}): Promise<CoverageReview> {
  const at = new Date();
  const dryRun = options.dryRun === true;
  const history = await readCoverageHistory(prisma, at);
  const window = referenceWindow(history);
  const startedAt = await runStartedAt(prisma, options.runId ?? null);
  // Un seul instant cohérent pour l'état comparé : lecture seule, instantané répétable.
  const { state, exposure } = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const state = await readCoverageState(tx, { at, before: options.before ?? null, runStartedAt: startedAt,
      horizons: { RUN: options.before?.at ?? null, LAST: window[0]?.takenAt ?? null, WINDOW: window[window.length - 1]?.takenAt ?? null } });
    // D-520 §3 : l'état d'exposition de toutes les offres, au même instant. Son échec ne retient jamais l'alerte de couverture :
    // le bulletin part, et dit que la répartition manque.
    const exposure = await tx.$executeRaw`SAVEPOINT exposition`
      .then(() => readExposureDistribution(tx, { at }))
      .catch(async (error: unknown) => {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT exposition`;
        log.assertHealthy();
        await log.error('coverage.exposure_failed', { error });
        return null;
      });
    return { state, exposure };
  }, { isolationLevel: 'RepeatableRead', timeout: 180_000, maxWait: 10_000 });
  const evaluation = evaluateCoverage({ entities: state.entities, knownSources: state.knownSources, history });
  await sourceLinks(prisma, evaluation);
  const indicators = await readLoopIndicators(prisma, { at, probe: options.probe ?? null, prisma });
  const registry = await readRegistry(prisma, at);
  // L'envoi d'abord : une photographie ne marque une alerte « posée » que si le bulletin qui la porte est parti.
  const sent = dryRun ? false : await sendOperatorEmail({ subject: bulletinSubject(evaluation), html: bulletinHtml(evaluation, indicators, { at, masked: state.masked, registry, exposure }),
    context: { findings: evaluation.findings.length, newAlerts: newAlerts(evaluation).length } });
  const rows = sent ? evaluation.rows : evaluation.rows.map(row => ({ ...row, cause: null, gravity: null }));
  const written = dryRun ? 0 : await writeCoverageSnapshot(prisma, { runId: options.runId ?? null, takenAt: at, rows });
  return { at, evaluation, indicators, masked: state.masked, registry, exposure, written, sent, dryRun };
}

/**
 * Une étape qui pose des retenues HORS RUN (`availability`, `probe-apply-links`), encadrée comme au RUN : l'avant, l'étape,
 * puis la revue et le bulletin (D-516 §2 : le masquage ne part jamais sans lui). `sent` est faux si l'avant, la revue ou
 * l'envoi ont échoué ; l'erreur est rendue, l'étape elle-même n'est jamais rejouée.
 */
export async function withCoverageReview<T>(prisma: PrismaClient, step: () => Promise<T>,
  probeOf: (result: T) => ProbeSummary | null = () => null): Promise<{ result: T; review: CoverageReview | null; sent: boolean; error: unknown }> {
  let before: CoverageBefore | null = null, error: unknown = null;
  try { before = await readCoverageBefore(prisma); } catch (caught) { error = caught; }
  const result = await step();
  if (!before) return { result, review: null, sent: false, error };
  try {
    const review = await runCoverageReview(prisma, { before, probe: probeOf(result) });
    return { result, review, sent: review.sent, error: null };
  } catch (caught) {
    return { result, review: null, sent: false, error: caught };
  }
}
