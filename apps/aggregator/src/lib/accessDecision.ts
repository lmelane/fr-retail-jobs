/**
 * LA DÉCISION D'ACCÈS — observer, fonder, décider sont TROIS choses (D62, 2026-09-13).
 *
 * Avant cette décision, `robotsVerdict` faisait tout : il observait **et** il décidait. Un `Disallow: /`
 * suffisait à mettre une source en pause, quelle que soit la nature de la surface et quelle que soit
 * l'autorisation du propriétaire.
 *
 * Le cas qui l'a imposé, lu à la source pendant la vague 1 de P9 : `api.smartrecruiters.com` sert
 * `User-agent: * / Disallow: /` (72 octets, sha256 `834faf99…`), alors que **46 sources du catalogue** y
 * lisent des offres **publiques**, dans un périmètre que le propriétaire déclare autorisé. Un champ unique ne
 * pouvait pas porter les deux vérités sans en écraser une.
 *
 * D'où trois champs indépendants :
 *
 *   · `robotsObserved`          — ce qu'on a LU, tel quel, jamais réécrit ;
 *   · `authorizationBasis`      — sur quoi on se FONDE pour accéder ;
 *   · `effectiveAccessDecision` — ce qu'on DÉCIDE de faire.
 *
 * **La règle cardinale : une décision favorable ne transforme jamais un `DISALLOWED` observé en `ALLOWED`.**
 * Le fait mesuré reste visible et archivé — c'est lui qui permettra, plus tard, d'expliquer pourquoi on a
 * collecté et sur quel fondement.
 *
 * La décision se prend sur **la surface réellement interrogée**, jamais sur le nom commercial de l'ATS : un
 * même éditeur expose des offres publiques et des données candidat, qui ne relèvent pas du même régime.
 */
import { CRAWLER_IDENTITY, BOT_INFO_URL } from './crawlerIdentity.js';

/** Ce qu'on a lu dans le robots.txt — repris de la lecture explicite de D60, jamais deviné. */
export type RobotsObserved = 'ALLOWED' | 'DISALLOWED' | 'NO_ROBOTS' | 'UNREACHABLE';

/** La nature de ce qu'on interroge. Liste FERMÉE : une surface inconnue doit être nommée avant d'être lue. */
export const ACCESS_SURFACES = [
  'PUBLIC_OFFICIAL_API',
  'PUBLIC_ATS_JOB_API',
  'PUBLIC_PORTAL_JSON',
  'PUBLIC_XML_OR_RSS',
  'PUBLIC_SITEMAP',
  'PUBLIC_OFFICIAL_HTML',
  'PUBLIC_ATS_HTML',
  'PUBLIC_JS_RENDERED_PAGE',
  'PRIVATE_OR_INTERNAL',
] as const;

export type AccessSurface = (typeof ACCESS_SURFACES)[number];

export type AuthorizationBasis = 'OWNER_SECTOR_AUTHORIZATION' | 'NONE';
export type EffectiveAccessDecision = 'ALLOWED' | 'NOT_AUTHORIZED';

/** Portée de la déclaration du propriétaire, et sa date : une autorisation sans portée est une signature en blanc. */
export const OWNER_DECISION_SCOPE = 'LUXURY_FASHION_BEAUTY_RETAIL_WATCHES_PUBLIC_JOBS';
export const OWNER_DECISION_AT = '2026-09-13';

export type AccessDecisionRecord = {
  readonly robotsObserved: RobotsObserved;
  readonly accessSurface: AccessSurface;
  readonly authorizationBasis: AuthorizationBasis;
  readonly effectiveAccessDecision: EffectiveAccessDecision;
  readonly crawlerIdentity: string;
  readonly botInfoUrl: string;
  readonly ownerDecisionScope: string;
  readonly ownerDecisionAt: string;
};

/** Une surface d'offres publiques, par opposition aux données privées ou internes. */
export function isPublicJobSurface(surface: AccessSurface): boolean {
  return surface !== 'PRIVATE_OR_INTERNAL';
}

/**
 * Assemble la décision. `robotsObserved` entre et ressort **inchangé** — la fonction ne le corrige pas, ne le
 * complète pas et ne le réinterprète pas.
 *
 * Pour une surface privée, l'autorisation sectorielle ne s'applique pas : `authorizationBasis` vaut `NONE` et
 * la décision est `NOT_AUTHORIZED`, quel que soit le robots — un robots permissif n'ouvre pas des données
 * candidat.
 */
export function accessDecision(input: {
  robotsObserved: RobotsObserved;
  accessSurface: AccessSurface;
}): AccessDecisionRecord {
  const isPublic = isPublicJobSurface(input.accessSurface);
  return {
    robotsObserved: input.robotsObserved,
    accessSurface: input.accessSurface,
    authorizationBasis: isPublic ? 'OWNER_SECTOR_AUTHORIZATION' : 'NONE',
    effectiveAccessDecision: isPublic ? 'ALLOWED' : 'NOT_AUTHORIZED',
    crawlerIdentity: CRAWLER_IDENTITY,
    botInfoUrl: BOT_INFO_URL,
    ownerDecisionScope: OWNER_DECISION_SCOPE,
    ownerDecisionAt: OWNER_DECISION_AT,
  };
}
