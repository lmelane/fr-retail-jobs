import { captureResponse, currentCaptureContext, describeRequest, noteUnsupportedTransport, replayWafCookie, type CaptureContext, type CaptureRequest } from '../capture/context.js';
import { observedHop } from '../capture/requestData.js';
import { log } from '../observability/logger.js';
import type { BootstrapObservation, BootstrapObserver } from './browser.js';
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
 * DANS UNE COLLECTE (D-483, 30/09/2026), l'amorçage n'est plus un transport caché : la collecte ne l'obtient que
 * si sa politique l'autorise (`CaptureContext.wafBootstrap`, liste nommée et décision d'accès), il est conduit au
 * plus une fois, sur une seule origine, chaque requête du navigateur est inscrite à SON journal, et le jeton
 * reste à elle (jamais celui d'une autre collecte du process). Hors collecte (outils de découverte), le
 * comportement historique demeure, mémorisé par origine pour le process.
 *
 * Ce module ne dépend pas de Playwright : l'amorceur réel (`primeWafToken`
 * dans browser.ts) est chargé paresseusement, et remplaçable dans les tests.
 */

/** Renvoie l'en-tête `cookie` à joindre, ou `undefined` si aucun jeton n'apparaît. */
export type WafPrimer = (url: string, observer?: BootstrapObserver) => Promise<string | undefined>;

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

/** Le cookie amorcé pour l'origine de cette URL, s'il existe — celui de la collecte en cours, s'il y en a une. */
export function getWafCookie(url: string): string | undefined {
  const context = currentCaptureContext();
  if (context?.replay) return replayWafCookie(url);
  if (context?.write) {
    const run = context.wafBootstrapRun;
    return run?.origin === originOf(url) ? run.value : undefined;
  }
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

async function defaultPrimer(url: string, observer?: BootstrapObserver): Promise<string | undefined> {
  const { primeWafToken } = await import('./browser.js');
  return primeWafToken(url, observer);
}

/**
 * Amorce le jeton de l'origine de `url`. Renvoie le cookie obtenu, ou `undefined` si le WAF n'en a posé aucun —
 * ou si rien n'autorise à l'amorcer. `vendor` : seul le défi AWS s'amorce dans une collecte.
 *
 * Hors collecte : une seule fois par origine et par process, même si quatre requêtes parallèles reçoivent le
 * challenge en même temps (comportement historique).
 */
export async function primeWafCookie(url: string, vendor = 'aws'): Promise<string | undefined> {
  const context = currentCaptureContext();
  if (context?.replay) return replayBootstrap(context, url);
  if (context?.write) return captureBootstrap(context, url, vendor);
  noteUnsupportedTransport();
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

/**
 * Rejeu hors réseau : l'amorçage n'est pas refait, il est CONSOMMÉ. La collecte archivée doit en porter les
 * requêtes pour cette origine (`replayBootstrap`), sinon le rejeu rend ce que la collecte avait rendu : aucun jeton.
 * Un rejeu sans ce contrôle (contextes de test) garde le jeton d'archive historique.
 */
function replayBootstrap(context: CaptureContext, url: string): string | undefined {
  const known = replayWafCookie(url);
  if (known) return known;
  if (context.replayBootstrap) {
    let recorded: boolean;
    try { recorded = context.replayBootstrap(originOf(url)); }
    catch (error) { context.failure ??= error as Error; throw error; }
    if (!recorded) return undefined;
  }
  return replayWafCookie(url, true);
}

/** En-têtes de réponse du navigateur, sans valeur multiligne (Playwright joint les `set-cookie` par saut de ligne). */
function responseHeaders(values: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    for (const line of value.split('\n')) {
      try { headers.append(name, line); } catch { /* une valeur invalide n'est pas archivable : ignorée */ }
    }
  }
  return headers;
}

/** Inscrit une requête du navigateur d'amorçage au journal de la collecte, comme un transport navigateur observé. */
async function recordBootstrapRequest(observation: BootstrapObservation): Promise<void> {
  const target = new URL(observation.url); target.hash = '';
  const request: CaptureRequest = { url: target.toString(), method: observation.method, body: observation.postData ?? undefined,
    headers: observation.requestHeaders ?? {}, format: 'BROWSER_RESPONSE', wafBootstrap: true };
  const headers = responseHeaders(observation.responseHeaders);
  const failure = observation.failure ? Object.assign(new Error(observation.failure), { name: observation.failure }) : undefined;
  const hop = observedHop(describeRequest(request), observation.status === null ? null : { status: observation.status, headers },
    observation.status === null ? failure : undefined);
  await captureResponse({ ...request, transport: { origin: 'BROWSER_TRANSPORT', hops: [hop] } }, {
    status: observation.status ?? undefined, headers, bytes: observation.body,
    complete: observation.body !== null && !observation.failure, ...(observation.failure ? { failure: observation.failure } : {}) });
}

/**
 * L'amorçage d'une collecte (D-483). Au plus un par collecte, sur une seule origine : une requête défiée sur une
 * autre origine échoue comme avant. Un amorçage refusé par la décision d'accès, ou qui n'obtient pas de jeton,
 * arrête la collecte entière (échec collant) : aucune publication ne peut reposer sur une lecture partielle.
 */
function captureBootstrap(context: CaptureContext, url: string, vendor: string): Promise<string | undefined> {
  const origin = originOf(url);
  const current = context.wafBootstrapRun;
  if (current) return current.origin === origin ? current.cookie : Promise.resolve(undefined);
  if (vendor !== 'aws') return Promise.resolve(undefined);
  let grant: ReturnType<NonNullable<CaptureContext['wafBootstrap']>>;
  try { grant = context.wafBootstrap?.(url) ?? null; }
  catch (error) {
    context.accessFailure ??= error as Error;
    return Promise.reject(error);
  }
  if (!grant) {
    return (async () => { await log.warn('waf.bootstrap_refused', { origin, reason: 'SOURCE_NOT_AUTHORIZED' }); return undefined; })();
  }
  const allow = grant.allow;
  const started = Date.now();
  const run: NonNullable<CaptureContext['wafBootstrapRun']> = { origin, cookie: Promise.resolve(undefined) };
  // Installé AVANT de lancer l'amorceur : ses premières requêtes peuvent être inscrites avant qu'il ne rende la main,
  // et `captureResponse` ne reconnaît une requête d'amorçage que pendant l'amorçage de cette collecte.
  context.wafBootstrapRun = run;
  run.cookie = (primer ?? defaultPrimer)(url, { allow: request => allow(request), record: recordBootstrapRequest })
    .then(async cookie => {
      await log.info('waf.bootstrap_completed', `[waf] ${origin}: amorçage inscrit ${cookie ? 'réussi' : 'sans jeton'} en ${Date.now() - started} ms`);
      if (!cookie) throw new WafChallengeError(url);
      run.value = cookie;
      return cookie;
    })
    .catch(async (error: unknown) => {
      if (!(error instanceof WafChallengeError)) await log.error('waf.bootstrap_failed', `[waf] ${origin}: amorçage inscrit en échec — ${error instanceof Error ? error.message : String(error)}`, { error });
      context.accessFailure ??= error instanceof Error ? error : new Error(String(error));
      throw error;
    });
  return run.cookie;
}
