/**
 * LA TÉLÉMÉTRIE HTTP PAR HÔTE — le seul endroit d'où l'on peut savoir ce qu'un portail nous a réellement coûté.
 *
 * P7 comptait deux nombres : tentatives et réponses. Suffisant pour dire « 0 retry », insuffisant pour dire
 * OÙ le temps passe. Or la première question de P8 — quelle famille ATS consomme le plus — ne se répond pas
 * sur un total : elle se répond **par hôte**, parce que c'est l'hôte qui impose la latence, qui throttle, et
 * qui décide si la porte par hôte (D25) doit ralentir.
 *
 * Le transport alimente ces compteurs : `fetchWithRetry` pour les extractions et chaque saut de
 * `fetchFollowingSafely` pour les captures de pages d'identité ou d'accès sans retry. Les adaptateurs
 * ne les incrémentent pas eux-mêmes. Les redirections d'extraction restent comptées dans leur tentative.
 *
 * Ce qu'il ne fait pas : estimer. Une taille de corps que le serveur n'annonce pas reste `null`, jamais 0 —
 * « je ne sais pas » et « rien » sont deux informations différentes, et les confondre fausse tout coût/octet.
 */

export type HostStats = {
  host: string;
  attempts: number;
  responses: number;
  retries: number;
  timeouts: number;
  errors: number;
  /** Répartition par code : `{200: 41, 404: 2}`. Un 404 attendu n'est pas une erreur, mais doit se voir. */
  statuses: Record<string, number>;
  /** Latences en ms, conservées pour les percentiles — bornées pour ne pas grossir indéfiniment. */
  latenciesMs: number[];
  /** Octets annoncés par `content-length`, quand il est présent. `null` si aucun ne l'était. */
  bytesDeclared: number | null;
  /** Réponses sans `content-length` : le dire empêche de lire `bytesDeclared` comme un total. */
  responsesWithoutLength: number;
};

const MAX_LATENCIES = 2_000;
const hosts = new Map<string, HostStats>();

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return 'url-invalide'; }
}

function statsFor(url: string): HostStats {
  const host = hostOf(url);
  let s = hosts.get(host);
  if (!s) {
    s = { host, attempts: 0, responses: 0, retries: 0, timeouts: 0, errors: 0,
          statuses: {}, latenciesMs: [], bytesDeclared: null, responsesWithoutLength: 0 };
    hosts.set(host, s);
  }
  return s;
}

export function recordAttempt(url: string, isRetry: boolean): void {
  const s = statsFor(url);
  s.attempts += 1;
  if (isRetry) s.retries += 1;
}

export function recordResponse(url: string, status: number, latencyMs: number, contentLength: string | null): void {
  const s = statsFor(url);
  s.responses += 1;
  s.statuses[String(status)] = (s.statuses[String(status)] ?? 0) + 1;
  // On garde les premières latences : un échantillon borné suffit aux percentiles, et une liste non bornée
  // ferait de la télémétrie elle-même une consommation mémoire à mesurer.
  if (s.latenciesMs.length < MAX_LATENCIES) s.latenciesMs.push(Math.round(latencyMs));
  const n = contentLength ? Number(contentLength) : NaN;
  if (Number.isFinite(n)) s.bytesDeclared = (s.bytesDeclared ?? 0) + n;
  else s.responsesWithoutLength += 1;
}

export function recordFailure(url: string, kind: 'timeout' | 'error'): void {
  const s = statsFor(url);
  if (kind === 'timeout') s.timeouts += 1; else s.errors += 1;
}

/** Percentile par rang, sur l'échantillon trié. `null` sur un échantillon vide, jamais 0. */
function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export type HostReport = {
  host: string;
  attempts: number; responses: number; retries: number; timeouts: number; errors: number;
  statuses: Record<string, number>;
  p50Ms: number | null; p95Ms: number | null; maxMs: number | null;
  bytesDeclared: number | null; responsesWithoutLength: number;
  /** Débit observé vers CET hôte, calculé par l'appelant qui connaît la durée de la fenêtre. */
  requestsPerSecond?: number | null;
};

export function snapshotHosts(windowSeconds?: number): HostReport[] {
  return [...hosts.values()].map((s) => {
    const sorted = [...s.latenciesMs].sort((a, b) => a - b);
    return {
      host: s.host, attempts: s.attempts, responses: s.responses, retries: s.retries,
      timeouts: s.timeouts, errors: s.errors, statuses: s.statuses,
      p50Ms: percentile(sorted, 50), p95Ms: percentile(sorted, 95),
      maxMs: sorted.length ? sorted[sorted.length - 1]! : null,
      bytesDeclared: s.bytesDeclared, responsesWithoutLength: s.responsesWithoutLength,
      requestsPerSecond: windowSeconds && windowSeconds > 0
        ? Number((s.attempts / windowSeconds).toFixed(2)) : null,
    };
  }).sort((a, b) => b.attempts - a.attempts);
}

/** Remis à zéro entre deux runs d'un même processus — sinon un second passage hériterait du premier. */
export function resetHosts(): void { hosts.clear(); }
