import { sourceDeadlineReached, sourceDelay } from './sourceBudget.js';

/**
 * UNE seule relecture, différée, des fiches en échec — la règle des listes génériques (29/09/2026, Pandora : l'éditeur
 * refuse tout pendant une cinquantaine de secondes), partagée depuis le 30/09/2026 avec Talentsoft (Groupe Chantelle :
 * des fiches redirigées vers l'accueil du portail, en rafale). Une règle, deux lecteurs : l'un ne dérive pas de l'autre.
 *
 * Bornée à quelques échecs — au plus 5, ou 5 % des fiches lues — et jamais quand toutes échouent, panne entière que
 * l'adaptateur nomme lui-même : un site en panne ou une porte refusée n'allonge pas le RUN. Le rejeu hors réseau sert
 * les réponses d'une même adresse dans l'ordre, et n'attend pas.
 */
export const DETAIL_RETRY_MAX_FAILURES = 5;
export const DETAIL_RETRY_MAX_RATIO = 0.05;
export const DETAIL_RETRY_DELAY_MS = 75_000;

/** La relecture est-elle permise pour `failed` fiches en échec sur `read` lues ? */
export function detailRetryAllowed(failed: number, read: number): boolean {
  return failed > 0 && failed < read && failed <= Math.max(DETAIL_RETRY_MAX_FAILURES, Math.ceil(read * DETAIL_RETRY_MAX_RATIO)) &&
    !sourceDeadlineReached();
}

/** Le délai avant la relecture ; `detailRetryDelayMs` ne sert qu'aux témoins. */
export async function waitBeforeDetailRetry(config: Record<string, unknown>): Promise<void> {
  await sourceDelay(Number(config.detailRetryDelayMs ?? DETAIL_RETRY_DELAY_MS));
}
