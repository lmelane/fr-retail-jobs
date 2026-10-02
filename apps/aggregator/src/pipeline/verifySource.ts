/**
 * D-520 §4 — LA VÉRIFICATION CIBLÉE : une réparation se vérifie tout de suite, sans attendre le RUN.
 *
 * `verifier-source <clé>` relance, pour UNE source, exactement la collecte du RUN (`ingestOne` : qualification d'accès et
 * native, lecture unique quand elle s'applique, ingestion, santé, `SourceRun`, classification), puis écrit son état
 * opérationnel (`VERIFICATION`). Mêmes gardes que la passe de découverte (D-517) : jamais dans la fenêtre du RUN
 * (15:30-18:30 UTC), jamais pendant un RUN ni pendant une passe, et bornée pour finir avant l'ouverture de la fenêtre. Rien n'est fermé ni masqué : comme `ingest --source`,
 * la collecte d'une seule source ne referme aucune offre (le refresh et la revue de disponibilité restent au RUN).
 */
import type { PrismaClient } from '@prisma/client';
import { ingestOne, type OrchestratorResult } from './ingestOrchestrator.js';
import { lightPassDeadline, lightPassRefusal, runningRuns, type LightPassRefusal } from './lightPass.js';
import { log } from '../observability/logger.js';
import { readSourceStatesReport } from './sourceStateStore.js';
import type { SourceState } from './sourceState.js';

export type VerificationRefusal = LightPassRefusal | 'SOURCE_INCONNUE' | 'SOURCE_NON_ACTIVE';
export type Verification = {
  sourceKey: string;
  refused: VerificationRefusal | null;
  /** L'état avant la vérification, tel que `etat-sources` le lit. */
  before: Awaited<ReturnType<typeof readSourceStatesReport>>['sources'][number] | { sourceKey: string; state: 'NORMALE' } | null;
  after: SourceState | null;
  /** Vérifiée et revenue à la normale, ou dans un état sur décision (échec connu D-480). */
  ok: boolean;
  failures: string[];
};

export async function verifySource(prisma: PrismaClient, key: string, options: { runId: string | null; now?: Date }): Promise<Verification> {
  const now = options.now ?? new Date();
  const source = await prisma.source.findUnique({ where: { key }, select: { key: true, status: true, kind: true } });
  if (!source) return { sourceKey: key, refused: 'SOURCE_INCONNUE', before: null, after: null, ok: false, failures: [] };
  const report = await readSourceStatesReport(prisma, now);
  const before = report.sources.find(s => s.sourceKey === key) ?? { sourceKey: key, state: 'NORMALE' as const };
  if (source.status !== 'ACTIVE') return { sourceKey: key, refused: 'SOURCE_NON_ACTIVE', before, after: null, ok: false, failures: [] };
  const refused = lightPassRefusal(now, await runningRuns(prisma, options.runId));
  if (refused) return { sourceKey: key, refused, before, after: null, ok: false, failures: [] };
  const result: OrchestratorResult = { total: 1, ok: 0, failed: 0, timedOut: 0, failures: [], incidents: [], issues: [], collectionKind: 'VERIFICATION' };
  // Bornée comme une passe : 90 minutes au plus, et jamais au-delà de l'ouverture de la fenêtre du RUN (15:30 UTC).
  await log.withContext({ sourceKey: key, connectorId: source.kind }, () => ingestOne(prisma, key, result, lightPassDeadline(now) - now.getTime()));
  const after = result.states?.find(s => s.sourceKey === key) ?? null;
  return { sourceKey: key, refused: null, before, after, failures: result.failures,
    ok: !!after && !result.stateFailures?.length && (after.state === 'NORMALE' || after.trajectory === 'DECISION') };
}
