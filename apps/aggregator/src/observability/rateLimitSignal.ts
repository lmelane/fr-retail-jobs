/**
 * LES 429 COMME SIGNAL DE CAPACITÉ — et l'arrêt franc des passages de mesure.
 *
 * Deux idées distinctes vivent ici, et il faut les garder distinctes.
 *
 * 1. UN 429 EST UNE INFORMATION, pas seulement un incident à rattraper. Un retry réussi protège les données ;
 *    il ne transforme pas la cadence qui a déclenché le refus en cadence recommandée. H1 l'a montré : trois
 *    429 rattrapés, zéro offre perdue — et pourtant cette enveloppe n'est PAS recommandable. On archive donc
 *    ce qu'il faut pour situer la limite : quelle clé, quel hôte, quelle source, quel `Retry-After`, combien
 *    de requêtes dans les fenêtres qui précèdent.
 *
 * 2. UN BENCHMARK NE DOIT PAS CONTINUER À POUSSER APRÈS AVOIR TROUVÉ LA LIMITE. Le protocole P8 disait « arrêt
 *    au premier 429 » ; H1 en a reçu trois et a poursuivi, parce que rien dans le code ne l'en empêchait. Une
 *    règle qu'aucun mécanisme n'applique n'est pas une règle. `P8_STOP_ON_FIRST_429=1` la rend exécutoire.
 *
 * Ce mode appartient aux PASSAGES DE MESURE. Il ne remplace pas la politique de retry du pipeline en
 * exploitation : un cron qui s'arrête au premier 429 abandonnerait des offres pour un incident transitoire.
 */

export type RateLimitHit = {
  at: string;
  rateLimitKey: string;
  host: string;
  sourceKey: string | null;
  url: string;
  attempt: number;
  /** La valeur BRUTE de l'en-tête, telle que l'hôte l'a écrite — `null` s'il n'en a pas mis. */
  retryAfterRaw: string | null;
  /** Le délai réellement appliqué, qui peut différer de ce qui est demandé (plafond, jitter). */
  appliedDelayMs: number;
  /** Pression juste avant le refus : c'est ce qui situe la limite. */
  requestsLast1s: number;
  requestsLast5s: number;
  requestsLast60s: number;
  activeConcurrency: number;
};

/** Erreur qui arrête un passage de mesure. Distincte d'une erreur réseau : elle est VOULUE. */
export class BenchmarkStoppedOn429Error extends Error {
  constructor(public readonly hit: RateLimitHit) {
    super(`passage de mesure arrêté : 429 de ${hit.rateLimitKey} (${hit.host}) sur ${hit.sourceKey ?? 'source inconnue'}`);
    this.name = 'BenchmarkStoppedOn429Error';
  }
}

const hits: RateLimitHit[] = [];
/** Horodatages des requêtes par clé, pour calculer la pression dans les fenêtres glissantes. */
const timeline = new Map<string, number[]>();

export function stopOnFirst429(): boolean {
  return process.env.P8_STOP_ON_FIRST_429 === '1';
}

/** Chaque requête sortante s'inscrit : sans cet historique, « combien de requêtes avant le 429 » est indevinable. */
export function noteRequest(rateLimitKey: string): void {
  const now = Date.now();
  const t = timeline.get(rateLimitKey) ?? [];
  t.push(now);
  // On ne garde que la dernière minute : au-delà, la fenêtre ne sert plus et la liste croîtrait sans fin.
  const cutoff = now - 60_000;
  while (t.length && t[0]! < cutoff) t.shift();
  timeline.set(rateLimitKey, t);
}

function windowCount(rateLimitKey: string, ms: number): number {
  const t = timeline.get(rateLimitKey) ?? [];
  const since = Date.now() - ms;
  return t.filter((x) => x >= since).length;
}

/**
 * Enregistre un 429 et dit s'il faut arrêter le passage.
 *
 * `retryAfterRaw` est conservé TEL QUEL, `null` compris : un hôte qui n'indique rien et un hôte qui demande
 * 0 seconde ne se confondent pas, et inventer un zéro effacerait la seule preuve que l'hôte est resté muet.
 */
export function record429(input: {
  rateLimitKey: string; host: string; sourceKey: string | null; url: string;
  attempt: number; retryAfterRaw: string | null; appliedDelayMs: number; activeConcurrency: number;
}): { shouldStop: boolean; hit: RateLimitHit } {
  const hit: RateLimitHit = {
    at: new Date().toISOString(),
    ...input,
    requestsLast1s: windowCount(input.rateLimitKey, 1_000),
    requestsLast5s: windowCount(input.rateLimitKey, 5_000),
    requestsLast60s: windowCount(input.rateLimitKey, 60_000),
  };
  hits.push(hit);
  return { shouldStop: stopOnFirst429(), hit };
}

export function rateLimitHits(): RateLimitHit[] { return [...hits]; }
export function resetRateLimitSignal(): void { hits.length = 0; timeline.clear(); }
