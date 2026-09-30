import { isChallengeHost } from '../connectors/wafBootstrap.js';
import { OfflineReplayError, type CaptureContext, type ReplayResponse } from './context.js';
import type { RequestData } from './requestData.js';

/** Une réponse archivée, relue avec son enveloppe de requête vérifiée. */
export type ReplayRow = { requestHash: string; format: string; data: RequestData | null };

/**
 * Le contexte de rejeu hors réseau d'une collecte archivée : chaque requête est servie par son empreinte, dans
 * l'ordre de capture ; une requête absente arrête le rejeu ; `left()` compte les réponses jamais consommées.
 *
 * L'AMORÇAGE WAF (D-483) n'est jamais refait : il est CONSOMMÉ. Ses requêtes inscrites (format `BROWSER_RESPONSE`,
 * transport navigateur observé) ne répondent à aucune requête HTTP ; seul `replayBootstrap` les retire, en bloc,
 * quand le lecteur rejoué rencontre le même défi que la collecte. Une collecte qui n'en a pas inscrit rend « aucun
 * jeton » (comme en direct : l'amorçage n'était pas autorisé) ; un rejeu qui en demande un pour une autre origine a
 * divergé ; un amorçage inscrit que le rejeu ne demande jamais reste compté dans `left()`.
 *
 * `legacyBootstrap` : une collecte historique dont l'amorçage n'était pas inscrit (`UNSUPPORTED_TRANSPORT`, ou
 * couverture inconnue d'une extraction antérieure) garde le jeton d'archive historique — elle ne peut de toute façon
 * certifier aucun accès.
 */
export function offlineReplay<R extends ReplayRow>(rows: readonly R[], respond: (row: R) => Promise<ReplayResponse>,
  options: { observedAt: Date; legacyBootstrap: boolean }): { context: CaptureContext; left: () => number } {
  const queues = new Map<string, R[]>();
  const bootstrap: { origins: Set<string>; rows: R[] } = { origins: new Set(), rows: [] };
  for (const row of rows) {
    if (!queues.has(row.requestHash)) queues.set(row.requestHash, []);
    queues.get(row.requestHash)!.push(row);
    if (row.format === 'BROWSER_RESPONSE' && row.data?.origin === 'BROWSER_TRANSPORT') {
      const origin = new URL(row.data.hops[0].request.url).origin;
      if (!isChallengeHost(origin)) bootstrap.origins.add(origin);
      bootstrap.rows.push(row);
    }
  }
  let consumed = false;
  const replayBootstrap = options.legacyBootstrap ? undefined : (origin: string) => {
    if (consumed || !bootstrap.rows.length) return false;
    // A recorded bootstrap loads the challenged document of ONE origin (the rest is the challenge infrastructure):
    // a replay asking another origin first diverged from the live collection.
    if (bootstrap.origins.size !== 1 || !bootstrap.origins.has(origin)) throw new OfflineReplayError('Offline replay requested a WAF bootstrap the capture did not record');
    for (const row of bootstrap.rows) {
      const queue = queues.get(row.requestHash)!;
      queue.splice(queue.indexOf(row), 1);
    }
    consumed = true;
    return true;
  };
  const context: CaptureContext = { sequence: 0, observedAt: options.observedAt, replayBootstrap, replay: async hash => {
    const row = queues.get(hash)?.shift();
    if (!row) throw new OfflineReplayError('Offline replay request is absent from the capture batch');
    return respond(row);
  } };
  return { context, left: () => [...queues.values()].reduce((sum, queue) => sum + queue.length, 0) };
}
