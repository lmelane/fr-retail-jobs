import { searchIndexStatus } from './search-index';

/**
 * LA SURVEILLANCE DE LA FILE DE RECHERCHE (D-475, plan docs/architecture/classification-metiers.md §3.2 et §3.6).
 *
 * L'indexeur de l'API vide la file de SA génération ; une file dont le plus ancien élément a plus de
 * `SEUIL_ALERTE_FILE_S` secondes signale un indexeur arrêté ou dépassé (un changement de version mal cadencé, un
 * reclassement massif). Au-delà de 300 s, la recherche devient indisponible (`requireSearchIndex`) : l'alerte part
 * bien avant. Une alerte par heure au plus, par e-mail d'exploitation (Brevo, comme l'alerte du RUN :
 * apps/aggregator/src/pipeline/alert.ts).
 *
 * Sans `BREVO_API_KEY` ni `BREVO_SENDER_EMAIL`, rien ne part : le service de l'API en production n'en portait pas le
 * 29/09/2026 (mesuré sur Railway, noms de variables seulement) ; les poser fait partie de la carte d'activation.
 * Ne lève jamais : une panne de surveillance ne doit pas arrêter l'indexeur.
 */
export const SEUIL_ALERTE_FILE_S = 60;
export const INTERVALLE_VERIFICATION_MS = 60_000;
export const INTERVALLE_ALERTE_MS = 3_600_000;

type Statut = { version: string; pending: number; oldestSeconds: number | null };
type Envoi = (sujet: string, html: string) => Promise<boolean>;
const etat = { derniereVerification: 0, derniereAlerte: 0 };

export async function surveillerFileRecherche(options: { maintenant?: number; statut?: () => Promise<Statut>; envoyer?: Envoi } = {}):
  Promise<'attente' | 'ok' | 'alerte' | 'non-envoyee' | 'deja-signalee'> {
  const maintenant = options.maintenant ?? Date.now();
  if (maintenant - etat.derniereVerification < INTERVALLE_VERIFICATION_MS) return 'attente';
  etat.derniereVerification = maintenant;
  try {
    const s = await (options.statut ?? searchIndexStatus)();
    if (s.oldestSeconds === null || s.oldestSeconds <= SEUIL_ALERTE_FILE_S) return 'ok';
    if (maintenant - etat.derniereAlerte < INTERVALLE_ALERTE_MS) return 'deja-signalee';
    const minutes = Math.round(s.oldestSeconds / 60);
    const sujet = `[Catwalks] File de recherche en retard : ${s.pending} offre(s), la plus ancienne depuis ${minutes} min`;
    const html = `<p>La génération de recherche <b>${s.version}</b> a ${s.pending} offre(s) en file ; la plus ancienne attend depuis
      ${Math.round(s.oldestSeconds)} s (seuil : ${SEUIL_ALERTE_FILE_S} s). Au-delà de 300 s, la recherche devient indisponible.</p>
      <p>Vérifier l'indexeur de l'API (<code>scripts/search/index.mts status</code>) et un éventuel reclassement en cours.</p>`;
    if (!(await (options.envoyer ?? envoyerAlerte)(sujet, html))) return 'non-envoyee';
    etat.derniereAlerte = maintenant;
    return 'alerte';
  } catch (error) {
    console.error(JSON.stringify({ event: 'search.monitor_failed', error: error instanceof Error ? error.name : 'unknown' }));
    return 'non-envoyee';
  }
}

/** Remise à zéro entre deux témoins. */
export function reinitialiserSurveillance() {
  etat.derniereVerification = 0;
  etat.derniereAlerte = 0;
}

async function envoyerAlerte(sujet: string, html: string): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY, sender = process.env.BREVO_SENDER_EMAIL;
  if (!apiKey || !sender) {
    console.warn(JSON.stringify({ event: 'search.monitor_unconfigured', message: 'BREVO_API_KEY/BREVO_SENDER_EMAIL absents : alerte non envoyée' }));
    return false;
  }
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({ sender: { email: sender, name: process.env.BREVO_SENDER_NAME || 'Catwalks' },
        to: [{ email: process.env.ALERT_EMAIL || 'loic.melane@catwalks.io' }], subject: sujet, htmlContent: html }),
    });
    if (!response.ok) console.error(JSON.stringify({ event: 'search.monitor_http_failed', status: response.status }));
    return response.ok;
  } catch (error) {
    console.error(JSON.stringify({ event: 'search.monitor_send_failed', error: error instanceof Error ? error.name : 'unknown' }));
    return false;
  }
}
