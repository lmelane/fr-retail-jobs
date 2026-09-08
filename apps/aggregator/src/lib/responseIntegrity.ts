/**
 * Intégrité d'une réponse HTTP — le détecteur générique d'anti-bot.
 *
 * RÈGLE D'ARCHITECTURE (Loïc, 2026-09-08) : « une anomalie externe ne doit
 * jamais pouvoir devenir silencieusement une corruption interne de notre
 * catalogue ». Ce module est le point unique où une réponse qui N'EST PAS la
 * page demandée est reconnue comme telle, AVANT d'atteindre le moindre parseur.
 *
 * Pourquoi générique et non « un if pour Cloudflare » : la même famille de
 * bugs s'est produite deux fois, sur deux fournisseurs différents.
 *
 *  - AWS WAF (careers.pvh.com, 2026-09-06) : 202 au corps vide, en-tête
 *    `x-amzn-waf-action: challenge`. Le générique a « lu » 0 offre sur 1 413.
 *  - Cloudflare (careers.loreal.com, 2026-09-08) : **HTTP 200** avec une page
 *    d'attente. `response.ok` était vrai, le parseur n'y trouvait aucune carte,
 *    et la source tombait BROKEN — 1 711 offres invisibles, sans une erreur.
 *    Prouvé par exécution : la même fonction de parsing rend 20 offres sur la
 *    vraie page et 0 sur la page challengée, toutes deux en 200.
 *
 * Le prochain fournisseur ne doit pas recréer ce bug : on ajoute une signature
 * ici, et TOUS les adaptateurs en bénéficient (règle D25).
 */

/** Les fournisseurs anti-bot reconnus. Ouvert : on en ajoute sans rien casser. */
export type ChallengeVendor = 'aws' | 'cloudflare' | 'akamai' | 'imperva' | 'datadome' | 'perimeterx';

/**
 * Signatures d'INFRASTRUCTURE, jamais de simples noms de marque.
 *
 * Le piège à éviter : une offre « Security Engineer » qui cite Cloudflare et
 * Akamai dans ses prérequis n'est pas un challenge. Chaque motif ci-dessous
 * vise un artefact que seul le fournisseur émet — un chemin technique, un
 * identifiant de ressource, un titre de page d'attente — jamais le mot seul.
 */
const SIGNATURES: ReadonlyArray<readonly [ChallengeVendor, RegExp]> = [
  // Cloudflare : le script du challenge, l'interstitiel « Just a moment… »,
  // ou la page « Checking your browser » servie en 503.
  [
    'cloudflare',
    /\/cdn-cgi\/challenge-platform\/|<title>\s*just a moment|checking your browser before accessing|cf-browser-verification|cf_chl_opt/i,
  ],
  // Imperva / Incapsula : la ressource injectée dans la page de blocage.
  ['imperva', /_incapsula_resource|incap_ses_|\/_Incapsula_Resource/i],
  // DataDome : le tag JS et la page de captcha.
  ['datadome', /js\.datadome\.co|captcha-delivery\.com|geo\.captcha-delivery/i],
  // PerimeterX / HUMAN : le conteneur de captcha et le bundle client.
  ['perimeterx', /px-captcha|\/px\/captcha|perimeterx\.net|_pxhd/i],
  // Akamai : la page « Access Denied » avec son numéro de référence.
  ['akamai', /reference\s*#\s*\d+[.\da-f]*|akamai\s+reference|ak_bmsc|_abck=/i],
];

/**
 * Le corps utile à inspecter : les marqueurs vivent en tête de page (head,
 * scripts d'amorçage). Borner évite de balayer 300 Ko de description d'offres
 * — et réduit d'autant le risque qu'un mot du contenu déclenche un faux
 * positif.
 */
const BODY_WINDOW = 4000;

/**
 * Le challenge AWS ne se lit PAS dans le corps (il est vide) mais dans le
 * couple statut + en-tête. Conservé identique au comportement historique.
 */
function isAwsChallenge(response: Response): boolean {
  return response.status === 202 && response.headers.get('x-amzn-waf-action') === 'challenge';
}

/**
 * Le fournisseur anti-bot ayant servi cette réponse, ou `undefined` si la
 * réponse est bien la page demandée.
 *
 * `body` est le texte DÉJÀ lu (le corps d'une Response ne se lit qu'une fois) ;
 * passer une chaîne vide n'inspecte que le statut et les en-têtes.
 */
export function detectChallenge(response: Response, body: string): ChallengeVendor | undefined {
  if (isAwsChallenge(response)) return 'aws';
  if (!body) return undefined;

  const window = body.slice(0, BODY_WINDOW);
  for (const [vendor, pattern] of SIGNATURES) {
    if (pattern.test(window)) return vendor;
  }
  return undefined;
}
