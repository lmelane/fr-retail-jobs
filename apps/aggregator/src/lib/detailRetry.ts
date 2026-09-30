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

/**
 * Talentsoft (30/09/2026) : la rafale de Groupe Chantelle du 29/09 a renvoyé 13 fiches sur 29 vers l'accueil, au-delà
 * de la borne des listes génériques ; ces tableaux ne dépassent pas 110 offres, et la relecture ne coûte qu'une attente.
 * Borne : moins de la moitié des fiches lues. Au-delà, c'est une panne du portail, nommée comme avant.
 */
export const TALENTSOFT_RETRY_MAX_RATIO = 0.5;

/** La relecture est-elle permise pour `failed` fiches en échec sur `read` lues ? `maxRatio` : la part tolérée. */
export function detailRetryAllowed(failed: number, read: number, maxRatio = DETAIL_RETRY_MAX_RATIO): boolean {
  const bound = maxRatio === DETAIL_RETRY_MAX_RATIO ? Math.max(DETAIL_RETRY_MAX_FAILURES, Math.ceil(read * maxRatio)) : Math.ceil(read * maxRatio) - 1;
  return failed > 0 && failed < read && failed <= bound && !sourceDeadlineReached();
}

/** Le délai avant la relecture ; `detailRetryDelayMs` ne sert qu'aux témoins. */
export async function waitBeforeDetailRetry(config: Record<string, unknown>): Promise<void> {
  await sourceDelay(Number(config.detailRetryDelayMs ?? DETAIL_RETRY_DELAY_MS));
}
