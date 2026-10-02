import { BROWSER_USER_AGENT } from '../lib/browser.js';
import { invalidAccess, type AccessScope } from './accessScope.js';

/**
 * L'AMORÇAGE D'UN DÉFI AWS WAF, PROUVÉ PAR LA POLITIQUE D'ACCÈS (D-483, 30/09/2026).
 *
 * Mesuré le 30/09/2026 : careers.ralphlauren.com répond à la première requête de la collecte par un défi AWS
 * (`202`, corps vide, `x-amzn-waf-action: challenge`), 3 fois sur 3. Le navigateur du collecteur, sous son identité
 * (`BROWSER_USER_AGENT`, D62), charge la page défiée ; le script du défi obtient un jeton `aws-waf-token` auprès de
 * l'infrastructure AWS, puis les requêtes HTTP ordinaires le rejouent. Jusqu'ici, ces requêtes du navigateur
 * n'entraient dans aucun journal : la politique d'accès ne pouvait pas les certifier et refusait toute collecte qui
 * en dépendait (`UNSUPPORTED_TRANSPORT`, `docs/architecture/source-access.md`).
 *
 * Ce module borne l'amorçage à ce qui a été mesuré et autorisé, et à rien d'autre :
 *
 *   1. une LISTE NOMMÉE de sources et d'origines (`WAF_BOOTSTRAP_SOURCES`) — la seule entrée est celle que D-483
 *      a tranchée ; une autre source défiée n'amorce dans AUCUNE collecte (qualification comprise) et échoue sur
 *      `WafChallengeError`, sans navigateur — avant ce lot, sa collecte de qualification amorçait hors journal ;
 *   2. un seul fournisseur, le défi AWS WAF (jamais un captcha, jamais un autre anti-robot) ;
 *   3. le navigateur n'envoie que la requête défiée elle-même (GET de l'adresse exacte) et des requêtes vers
 *      l'infrastructure du défi (hôtes `*.awswaf.com`) ; toute autre requête soumise à `route` est refusée AVANT
 *      l'envoi ; une redirection, que le navigateur suit sans `route`, part — elle fait alors échouer l'amorçage
 *      (inscrite si elle précède la vidange du journal, jamais inscrite sinon) et la collecte ;
 *   4. chaque requête partie est inscrite au journal de la collecte (`BROWSER_RESPONSE`), relue par l'inspection
 *      d'accès, et consommée à l'identique par le rejeu hors réseau ;
 *   5. dans le RUN, la décision d'accès courante doit déclarer l'amorçage (`bootstraps`) : origine et hôtes du défi,
 *      DÉRIVÉS des requêtes réellement observées pendant la collecte de qualification, jamais écrits à la main.
 *
 * Rien ici ne résout un défi à la place du navigateur, ni ne change l'identité du collecteur.
 */

/** D-483 : la seule source autorisée à lever un défi AWS par amorçage navigateur, et sa seule origine. */
export const WAF_BOOTSTRAP_SOURCES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'ralph-lauren-avature': Object.freeze(['https://careers.ralphlauren.com']),
});

export const WAF_BOOTSTRAP_VENDOR = 'AWS_WAF_CHALLENGE';
/** Une seule autorisation d'amorçage (une origine) par décision d'accès. */
export const MAX_ACCESS_BOOTSTRAPS = 1;
/**
 * D-516 §1 (02/10/2026) : une collecte conduit au plus DEUX amorçages, sur la même origine et sous la même
 * autorisation : le premier, puis un seul renouvellement quand le jeton est refusé après une page acceptée
 * (`wafRefusal`, lib/wafToken.ts). Un troisième n'existe pas : la collecte échoue franchement.
 */
export const MAX_COLLECTION_BOOTSTRAPS = 2;
export const MAX_CHALLENGE_HOSTS = 8;

export type AccessBootstrap = { vendor: typeof WAF_BOOTSTRAP_VENDOR; origin: string; challengeHosts: string[] };
export type BootstrapRequestShape = { url: string; method: string };

/** Une origine HTTPS exacte et normalisée (sans port explicite, chemin, identifiants ni requête). */
function exactOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && !url.username && !url.password ? url : null;
  } catch { return null; }
}

/** L'infrastructure du défi AWS : un hôte sous `awswaf.com`, en HTTPS, sans port. */
export function isChallengeHost(origin: string): boolean {
  const url = exactOrigin(origin);
  return !!url && !url.port && /^(?:[a-z0-9-]+\.)+awswaf\.com$/.test(url.hostname);
}

export function bootstrapAuthorizedFor(sourceKey: string, origin: string): boolean {
  return Object.hasOwn(WAF_BOOTSTRAP_SOURCES, sourceKey) && WAF_BOOTSTRAP_SOURCES[sourceKey].includes(origin);
}

/** L'adresse défiée, telle que le navigateur la demande : sans fragment. */
function target(value: string): string {
  const url = new URL(value); url.hash = '';
  return url.toString();
}

function isTarget(request: BootstrapRequestShape, challenged: string): boolean {
  try { return request.method.toUpperCase() === 'GET' && target(request.url) === target(challenged); }
  catch { return false; }
}

function originOf(value: string): string | null {
  try { return new URL(value).origin; } catch { return null; }
}

/**
 * Collecte de QUALIFICATION (aucune décision encore, ou pour la renouveler) : la page défiée elle-même, et
 * l'infrastructure du défi AWS. C'est ce que la dérivation observera, puis ce que la décision autorisera.
 */
export function observeModeAllow(challenged: string): (request: BootstrapRequestShape) => boolean {
  return request => isTarget(request, challenged) || isChallengeHost(originOf(request.url) ?? '');
}

/** Collecte du RUN, sous décision : la page défiée elle-même, et les seuls hôtes du défi que la décision déclare. */
export function grantedAllow(challenged: string, bootstrap: AccessBootstrap): (request: BootstrapRequestShape) => boolean {
  const hosts = new Set(bootstrap.challengeHosts);
  return request => isTarget(request, challenged) || hosts.has(originOf(request.url) ?? '');
}

/** Le contrat de `document.bootstraps` : borné, exact, dérivé d'une origine qui a un périmètre HTTP revu. */
export function parseAccessBootstraps(value: unknown, scopes: readonly AccessScope[], sourceKey?: string): AccessBootstrap[] {
  if (!Array.isArray(value) || value.length > MAX_ACCESS_BOOTSTRAPS) return invalidAccess('Access bootstraps require a bounded explicit list');
  for (const item of value as AccessBootstrap[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 3 ||
      !['vendor', 'origin', 'challengeHosts'].every(key => Object.hasOwn(item, key)) || item.vendor !== WAF_BOOTSTRAP_VENDOR ||
      typeof item.origin !== 'string' || !exactOrigin(item.origin) || !Array.isArray(item.challengeHosts) ||
      !item.challengeHosts.length || item.challengeHosts.length > MAX_CHALLENGE_HOSTS ||
      item.challengeHosts.some(host => typeof host !== 'string' || !isChallengeHost(host)) ||
      item.challengeHosts.join('\n') !== [...new Set(item.challengeHosts)].sort().join('\n')) return invalidAccess('Invalid WAF bootstrap authorization');
    // Un amorçage ne rejoue qu'une requête défiée : son origine doit avoir un périmètre HTTP GET revu.
    if (!scopes.some(scope => scope.origin === item.origin && scope.methods.includes('GET'))) return invalidAccess('A WAF bootstrap needs a reviewed HTTP scope on its origin');
    // Défense en profondeur : même un document forgé ne déclare d'amorçage que pour la source et l'origine nommées.
    if (sourceKey !== undefined && !bootstrapAuthorizedFor(sourceKey, item.origin)) return invalidAccess('This source is not authorized to bootstrap a WAF challenge (D-483)');
  }
  return value as AccessBootstrap[];
}

/** Une requête d'amorçage relue dans le journal : son adresse, sa méthode, l'identité qu'elle a portée, son rang. */
export type ObservedBootstrapRequest = { sequence: number; url: URL; method: string; userAgent: string | null };
/** Un défi AWS relu dans le journal HTTP : le `202` marqué `x-amzn-waf-action: challenge`, et son rang. */
export type ObservedChallenge = { sequence: number; url: string };

/**
 * L'amorçage que le journal d'une collecte PROUVE, ou `null` s'il n'y en a pas. Refuse — plutôt que de dériver
 * une autorisation plus large que l'observé — tout journal où une requête du navigateur :
 *   - précède le défi qui l'aurait justifiée, ou vise une autre origine que celle du défi ;
 *   - demande autre chose que l'adresse défiée elle-même (GET) sur l'origine, ou un hôte hors de l'infrastructure
 *     du défi ;
 *   - n'a pas porté l'identité du collecteur dans le navigateur ;
 * et toute source ou origine que D-483 n'a pas nommée.
 */
export function deriveAccessBootstrap(sourceKey: string, challenges: readonly ObservedChallenge[],
  requests: readonly ObservedBootstrapRequest[]): AccessBootstrap | null {
  if (!requests.length) return null;
  const ordered = [...requests].sort((a, b) => a.sequence - b.sequence);
  // L'origine défiée se lit sur la requête cible, jamais sur l'ordre d'inscription : les réponses du navigateur
  // s'inscrivent dans l'ordre où elles se terminent, pas dans celui où elles sont parties.
  const targets = new Set(ordered.filter(request => !isChallengeHost(request.url.origin)).map(request => request.url.origin));
  if (targets.size !== 1) throw new Error('ACCESS_BOOTSTRAP: un amorçage ne joint que la page défiée d\'une seule origine et l\'infrastructure du défi');
  const [origin] = targets;
  const trigger = challenges.find(challenge => challenge.sequence < ordered[0].sequence && originOf(challenge.url) === origin);
  if (!trigger) throw new Error('ACCESS_BOOTSTRAP: amorçage sans défi AWS archivé qui le précède sur son origine');
  if (!bootstrapAuthorizedFor(sourceKey, origin)) throw new Error(`ACCESS_BOOTSTRAP: ${sourceKey} n'est pas autorisée à lever un défi sur ${origin} (D-483)`);
  const challenged = challenges.filter(challenge => originOf(challenge.url) === origin).map(challenge => challenge.url);
  const hosts = new Set<string>();
  for (const request of ordered) {
    if (request.userAgent !== BROWSER_USER_AGENT) throw new Error('ACCESS_BOOTSTRAP: requête d\'amorçage sans l\'identité du collecteur');
    if (request.url.origin === origin) {
      if (!challenged.some(url => isTarget({ url: request.url.toString(), method: request.method }, url)))
        throw new Error('ACCESS_BOOTSTRAP: requête d\'amorçage hors de l\'adresse défiée');
    // Toute autre origine hors de l'infrastructure du défi a déjà été refusée (une seule origine cible, ci-dessus).
    } else hosts.add(request.url.origin);
  }
  if (!hosts.size || hosts.size > MAX_CHALLENGE_HOSTS) throw new Error('ACCESS_BOOTSTRAP: infrastructure du défi non observée ou trop étendue');
  return { vendor: WAF_BOOTSTRAP_VENDOR, origin, challengeHosts: [...hosts].sort() };
}

/**
 * La requête d'amorçage `request` est-elle couverte par l'autorisation `bootstrap` ? L'adresse défiée elle-même
 * (GET exact, parmi les défis archivés de la collecte) ou un hôte du défi déclaré, sous l'identité du collecteur.
 */
export function bootstrapRequestCovered(bootstrap: AccessBootstrap, challenged: readonly string[], request: ObservedBootstrapRequest): boolean {
  if (request.userAgent !== BROWSER_USER_AGENT || request.url.username || request.url.password || request.url.hash) return false;
  if (request.url.origin === bootstrap.origin) return challenged.some(url => originOf(url) === bootstrap.origin &&
    isTarget({ url: request.url.toString(), method: request.method }, url));
  return bootstrap.challengeHosts.includes(request.url.origin);
}

/**
 * Fin de collecte (D-483) : le journal de l'amorçage que cette collecte a inscrit tient-il dans son autorisation ?
 * Sous décision, chaque requête doit être couverte par l'amorçage déclaré ; sans décision (qualification), l'amorçage
 * doit pouvoir être dérivé. Une requête qui a échappé au filtre du navigateur (redirection suivie par le navigateur,
 * que `route` ne voit pas) arrête ici la collecte : jamais de publication sur un transport hors bornes.
 */
export function assertJournaledBootstrap(sourceKey: string, bootstraps: readonly AccessBootstrap[] | null,
  challenges: readonly ObservedChallenge[], requests: readonly ObservedBootstrapRequest[]): void {
  if (!requests.length) return;
  if (!bootstraps) { deriveAccessBootstrap(sourceKey, challenges, requests); return; }
  const origins = new Set(requests.filter(request => !isChallengeHost(request.url.origin)).map(request => request.url.origin));
  const grant = origins.size === 1 ? bootstraps.find(item => origins.has(item.origin)) : undefined;
  const challenged = challenges.map(challenge => challenge.url);
  if (!grant || !bootstrapAuthorizedFor(sourceKey, grant.origin) || requests.some(request => !bootstrapRequestCovered(grant, challenged, request)))
    throw new Error('ACCESS_BOOTSTRAP: une requête d\'amorçage inscrite sort de l\'autorisation de la collecte');
}
