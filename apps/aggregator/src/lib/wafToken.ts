import { log } from '../observability/logger.js';
/**
 * Jetons WAF par origine — la table que `fetchWithRetry` consulte pour joindre
 * un cookie amorcé à TOUTE requête sortante vers un hôte protégé (règle D25 :
 * la cause se corrige une fois pour toutes les requêtes, jamais par adaptateur).
 *
 * Mesuré le 2026-09-06 sur careers.pvh.com (AWS WAF) : une requête isolée
 * passe, mais dès qu'on enchaîne, chaque réponse est un **202 au corps vide**
 * avec `x-amzn-waf-action: challenge` — que `response.ok` prenait pour une
 * page. Le générique a ainsi « lu » 0 offre sur 1 413 en 114 s, sans erreur.
 * Avec le cookie `aws-waf-token` posé par une seule navigation Chromium, les
 * 1 347 pages passent en HTTP simple (0 challenge, 409 s).
 *
 * Ce module ne dépend pas de Playwright : l'amorceur réel (`primeWafToken`
 * dans browser.ts) est chargé paresseusement, et remplaçable dans les tests.
 */

/** Renvoie l'en-tête `cookie` à joindre, ou `undefined` si aucun jeton n'apparaît. */
export type WafPrimer = (url: string) => Promise<string | undefined>;

const cookies = new Map<string, string>();
const inflight = new Map<string, Promise<string | undefined>>();
let primer: WafPrimer | undefined;

/**
 * Levée quand le challenge persiste après amorçage : jamais un corps vide — ni
 * une page d'attente — accepté comme page.
 *
 * `vendor` nomme le fournisseur anti-bot rencontré (aws, cloudflare, akamai…).
 * Il remonte jusqu'au SourceRun : « CHALLENGED par cloudflare » est un
 * diagnostic exploitable, là où « 0 offre » envoyait chercher un bug d'adaptateur
 * qui n'existait pas (cf. L'Oréal, 2026-09-08).
 */
export class WafChallengeError extends Error {
  readonly vendor: string;

  constructor(url: string, vendor = 'aws') {
    super(`Challenge ${vendor} non levé pour ${url}`);
    this.name = 'WafChallengeError';
    this.vendor = vendor;
  }
}

/** Un 202 sans contenu marqué `x-amzn-waf-action: challenge` : le WAF Amazon, pas la page. */
export function isWafChallenge(response: Response): boolean {
  return response.status === 202 && response.headers.get('x-amzn-waf-action') === 'challenge';
}

function originOf(url: string): string {
  return new URL(url).origin;
}

/** Le cookie amorcé pour l'origine de cette URL, s'il existe. */
export function getWafCookie(url: string): string | undefined {
  return cookies.get(originOf(url));
}

/** Remplace l'amorceur (tests). `undefined` rétablit l'amorceur navigateur. */
export function setWafPrimer(custom: WafPrimer | undefined): void {
  primer = custom;
}

/** Oublie jetons et amorçages en cours (tests). */
export function clearWafTokens(): void {
  cookies.clear();
  inflight.clear();
}

async function defaultPrimer(url: string): Promise<string | undefined> {
  const { primeWafToken } = await import('./browser.js');
  return primeWafToken(url);
}

/**
 * Amorce le jeton de l'origine de `url` — une seule fois par origine et par
 * process, même si quatre requêtes parallèles reçoivent le challenge en même
 * temps. Renvoie le cookie obtenu, ou `undefined` si le WAF n'en a posé aucun.
 */
export async function primeWafCookie(url: string): Promise<string | undefined> {
  const origin = originOf(url);
  const known = cookies.get(origin);
  if (known) return known;

  let pending = inflight.get(origin);
  if (!pending) {
    const started = Date.now();
    pending = (primer ?? defaultPrimer)(url)
      .then(async (cookie) => {
        if (cookie) cookies.set(origin, cookie);
        await log.info('waf.bootstrap_completed', `[waf] ${origin}: amorçage ${cookie ? 'réussi' : 'sans jeton'} en ${Date.now() - started} ms`);
        return cookie;
      })
      .catch(async (error: unknown) => {
        await log.error('waf.bootstrap_failed', `[waf] ${origin}: amorçage en échec — ${error instanceof Error ? error.message : String(error)}`, { error });
        return undefined;
      });
    inflight.set(origin, pending);
  }
  return pending;
}
