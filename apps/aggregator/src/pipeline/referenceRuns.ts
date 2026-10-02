/**
 * R-143 §1 — QUELLES COLLECTES SERVENT DE RÉFÉRENCE AUX GARDES DU RUN.
 *
 * Les gardes d'effondrement (santé, `health.ts`), du droit d'attester une absence et de la crédibilité d'une collecte
 * (`attestingCapture.ts`, donc le refresh et la revue de disponibilité) comparent une collecte à « la dernière
 * collecte productive » de sa source. Une passe légère (`lightPass.ts`, commande `ingest-light`) n'en est jamais une :
 * sinon une source tombée de 100 à 40 offres à la passe de 04:00, puis à 40 au RUN de 16:00, comparerait 40 à 40 et le
 * RUN fermerait 60 offres sur un effondrement qu'il ne verrait plus. La passe garde sa propre ligne de santé, qui ne se
 * compare à rien (lecture incrémentale, D-517, `health.ts`) ; seules les collectes hors passe deviennent des références.
 *
 * Une collecte appartient à une passe quand son run (`SourceRun.runId`, `CaptureBatch.runId`) est un `PipelineRun` de
 * commande `ingest-light`. Les runs ciblés (`ingest --source`) gardent leur rôle actuel.
 */
import type { Prisma } from '@prisma/client';

export const LIGHT_PASS_RUN_COMMAND = 'ingest-light';

/** Les runs de passe légère parmi `runIds` (tous quand `runIds` est omis). */
export async function lightPassRunIds(db: Prisma.TransactionClient, runIds?: readonly string[]): Promise<Set<string>> {
  if (runIds && runIds.length === 0) return new Set();
  const rows = await db.pipelineRun.findMany({
    where: { command: LIGHT_PASS_RUN_COMMAND, ...(runIds ? { id: { in: [...runIds] } } : {}) }, select: { id: true } });
  return new Set(rows.map(row => row.id));
}
