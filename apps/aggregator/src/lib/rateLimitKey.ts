/**
 * LA CLÉ DE LIMITATION — le budget que l'ÉDITEUR nous accorde, qui n'est pas toujours un hostname.
 *
 * P8 a mesuré les deux faces du problème, et elles se contredisent si on ne distingue pas les deux notions :
 *
 *  · `fastretailing.wd3.myworkdayjobs.com` — quatre sources, UN hostname. La porte a bien mutualisé, et le
 *    tenant a quand même rendu trois 429. Ici hostname = tenant, et la protection tient tout juste.
 *  · `urbn-hub` — UNE source configurée, HUIT sous-domaines iCIMS (`stores-na`, `homeoffice-eu`,
 *    `supplychain-na`…), 1 398 requêtes. La porte accorde huit budgets séparés à un seul client iCIMS. Ici
 *    hostname ≠ tenant, et la protection est huit fois trop permissive.
 *
 * D'où deux clés, délibérément séparées :
 *  · le HOSTNAME observé reste la clé du DIAGNOSTIC — c'est lui qui porte la latence et les statuts ;
 *  · la `rateLimitKey` devient la clé de la PROTECTION — sémaphore, cadence et cooldown partagés.
 *
 * LE PIÈGE À NE PAS COMMETTRE : dériver la clé de l'eTLD+1. Cela regrouperait `hub-urbn.icims.com` et
 * `careers-autreclient.icims.com` sous un « icims.com » global — deux clients indépendants punis l'un pour
 * l'autre, et un ralentissement inexplicable pour l'un quand l'autre est ingéré. La clé doit venir de
 * l'identité du TENANT, pas de celle de l'hébergeur.
 */

/**
 * Tenants connus, reconnus par un motif de sous-domaine — et jamais par le domaine de l'hébergeur seul.
 *
 * Chaque entrée nomme un client précis dont on a MESURÉ qu'il éclate en plusieurs hostnames. On n'y ajoute
 * rien par précaution : une entrée de trop regroupe des budgets qui n'ont aucune raison de l'être.
 */
const TENANT_PATTERNS: Array<{ test: RegExp; key: string; why: string }> = [
  // URBN : huit sous-domaines iCIMS mesurés sur un seul run T1, tous du même client.
  { test: /(^|[.-])urbn\.icims\.com$/i, key: 'tenant:urbn.icims', why: 'URBN — 8 sous-domaines iCIMS mesurés (T1)' },
  // Workday : le tenant est le premier label, l'instance (wd1, wd3, wd5) n'est qu'un centre de données.
  { test: /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i, key: '', why: 'Workday — le tenant est le premier label' },
];

/**
 * La clé de limitation d'une URL.
 *
 * `explicit` prime toujours : une configuration de source qui nomme son tenant sait ce que la déduction
 * ignore. Sans elle, on reconnaît les tenants mesurés, puis on retombe sur le HOSTNAME — repli conservateur :
 * il protège au moins autant que l'absence de clé, et jamais moins.
 */
export function rateLimitKeyFor(url: string, explicit?: string | null): string {
  if (explicit && explicit.trim()) return `explicit:${explicit.trim()}`;

  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return `host:${url}`; }

  for (const { test, key } of TENANT_PATTERNS) {
    const m = host.match(test);
    if (!m) continue;
    // Motif à capture (Workday) : le tenant est le groupe capturé, pas une constante.
    if (!key) return `tenant:${m[1]!.toLowerCase()}.workday`;
    return key;
  }

  // Repli : le hostname lui-même. Conservateur — deux hostnames distincts gardent deux budgets, ce qui est le
  // comportement d'avant. On ne regroupe JAMAIS par défaut : un regroupement erroné ralentit un tiers innocent.
  return `host:${host}`;
}

/** Le hostname observé, conservé séparément pour le diagnostic. */
export function observedHost(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return 'url-invalide'; }
}
