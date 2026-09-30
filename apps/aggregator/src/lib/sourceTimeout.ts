/**
 * LE BUDGET D'UNE SOURCE DANS LE RUN, PROPORTIONNÉ À SON VOLUME (D-482, 30/09/2026).
 *
 * Jusqu'ici, 40 minutes pour chaque source, quelle que soit sa taille. ulta-jibe (~10 000 offres) a été coupée le
 * 28/09 à 2 400 s, sans rapport de fin, donc sans droit d'attester l'absence de ses offres, et le RUN a échoué.
 * L'éditeur avait répondu normalement (102 requêtes, 85 s) : c'est notre écriture qui a manqué de temps. Ce jour-là,
 * tout le RUN écrivait 3 à 4 fois plus lentement (324 ms par offre écrite en moyenne contre 78 à 86 ms les 25, 26,
 * 27 et 29/09 ; 195 ms le 24/09) ; ulta écrivait environ 250 ms par offre et en avait écrit ~7 400 sur 10 053 à la
 * coupure — il lui fallait ~51 minutes. Le 24/09, elle avait fini en 34 minutes, à 6 minutes de la coupure ; le 28/09,
 * urbn-hub, tapestry, lvmh et wttj-sector ont fini entre 33 et 35 minutes
 * (`scripts/ops/mesures/d482-ulta-jibe-temps.mts`).
 *
 * Le budget garde sa base (INGEST_SOURCE_TIMEOUT_MS, 40 minutes : collecte, qualification, validations) et reçoit
 * une allocation d'écriture par offre attendue, au rythme d'un jour lent mesuré (250 ms), bornée à deux heures. Une
 * petite source garde presque sa base (300 offres : + 75 s). Le volume attendu est le plus grand nombre d'offres qu'une collecte
 * de la source a rendu sur les huit derniers jours : une source coupée enregistre 0 offre, et son budget ne doit pas
 * retomber à la base le lendemain.
 */
export const BASE_SOURCE_TIMEOUT_MS = Number(process.env.INGEST_SOURCE_TIMEOUT_MS ?? 40 * 60_000);
/** L'écriture d'une offre un jour lent : 250 ms mesurées pour ulta-jibe au RUN du 28/09/2026. */
export const WRITE_ALLOWANCE_MS_PER_JOB = Number(process.env.INGEST_SOURCE_MS_PER_JOB ?? 250);
export const MAX_SOURCE_TIMEOUT_MS = Number(process.env.INGEST_SOURCE_MAX_TIMEOUT_MS ?? 120 * 60_000);
/** La fenêtre où se lit le volume attendu d'une source. */
export const EXPECTED_VOLUME_WINDOW_DAYS = 8;

/** Le budget d'une source qui a rendu au plus `expectedJobs` offres récemment. */
export function sourceTimeoutMs(expectedJobs: number): number {
  const jobs = Number.isSafeInteger(expectedJobs) && expectedJobs > 0 ? expectedJobs : 0;
  const budget = BASE_SOURCE_TIMEOUT_MS + jobs * WRITE_ALLOWANCE_MS_PER_JOB;
  return Math.max(BASE_SOURCE_TIMEOUT_MS, Math.min(budget, Math.max(MAX_SOURCE_TIMEOUT_MS, BASE_SOURCE_TIMEOUT_MS)));
}

/** Le volume attendu : le plus grand `jobs` des collectes récentes de la source (0 quand elle n'en a aucune). */
export function expectedVolume(recentJobs: readonly (number | null | undefined)[]): number {
  return recentJobs.reduce<number>((max, jobs) => (typeof jobs === 'number' && Number.isSafeInteger(jobs) && jobs > max ? jobs : max), 0);
}
