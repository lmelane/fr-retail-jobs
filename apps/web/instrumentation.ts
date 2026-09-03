/**
 * Dead man's switch du pipeline (décision Loïc, 2026-09-03).
 *
 * Un échec de migration bloque les TROIS crons en silence : la commande tombe
 * avant le pipeline, et le digest Brevo ne part que quand un run se termine —
 * donc jamais. Le site, lui, est un service long-vivant dans un domaine de
 * panne séparé (son image ne migre pas le schéma) : c'est lui qui surveille.
 *
 * Toutes les heures : si aucun SourceRun n'a été enregistré depuis 24 h, un
 * email part via Brevo (au plus un par 24 h). Couvre aussi le cron jamais
 * planifié, le conteneur qui boucle, et l'orchestrateur pendu. No-op propre
 * sans BREVO_API_KEY (comme le digest côté aggregator).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startPipelineDeadman } = await import('./lib/deadman');
  startPipelineDeadman();
}
