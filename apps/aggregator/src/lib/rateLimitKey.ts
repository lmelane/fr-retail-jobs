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
  /*
   * EIGHTFOLD : UN SEUL COMPTEUR POUR DEUX CLIENTS (mesuré le 30/09/2026 sur le RUN du 29/09, lecture seule).
   *
   * Estée Lauder (`elcompanies.eightfold.ai`) et Kering (`careers.kering.com`, CNAME de `kering.eightfold.ai`) sont
   * servis par deux distributions CloudFront distinctes, mais le pare-feu d'Eightfold les compte ENSEMBLE : ses trois
   * fenêtres de refus du 29/09 (405, `x-amzn-waf-action: captcha`) se sont ouvertes et levées dans les mêmes secondes
   * pour les deux sources (16:13:51 et 16:14:00, 16:20:20 pour les deux, 16:27:01 et 16:27:07), chaque fois que leur
   * cumul dépassait environ 1 000 requêtes sur cinq minutes glissantes. Deux budgets séparés accordaient donc le
   * double de ce que l'éditeur tolère. Deux clients distincts comptés ensemble : le compteur est celui de l'éditeur,
   * d'où la clé sur `*.eightfold.ai` entier. Un troisième client n'a pas été mesuré ; il n'est regroupé que par
   * cette inférence, dans le sens prudent (il ralentit, il ne déclenche pas).
   */
  { test: /(^|\.)eightfold\.ai$/i, key: 'tenant:eightfold', why: 'Eightfold — un pare-feu commun à Estée Lauder et Kering, refus simultanés mesurés (29/09)' },
  { test: /^careers\.kering\.com$/i, key: 'tenant:eightfold', why: 'Kering — careers.kering.com est servi par kering.eightfold.ai (CNAME, 30/09)' },
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

/**
 * LA CADENCE PLANCHER D'UNE CLÉ — l'écart minimal entre deux départs de requête, quand l'éditeur a un seuil MESURÉ.
 *
 * L'écart de base de la porte (`HOST_BASE_GAP_MS`, 80 ms) laisse passer jusqu'à 750 requêtes par minute et par
 * clé : il protège un hôte d'une rafale, pas d'un seuil sur cinq minutes. Eightfold refuse au-delà d'environ 1 000
 * requêtes sur cinq minutes glissantes, ses deux clients ensemble (voir `tenant:eightfold`) ; le 29/09, rafales et
 * fenêtres de refus alternaient à 187 requêtes par minute en moyenne, et chaque fenêtre coûtait des fiches.
 *
 * 350 ms entre deux départs : au plus 171 requêtes par minute, 857 sur cinq minutes, 14 % sous le seuil ESTIMÉ (le
 * pare-feu ne le publie pas : 1 000 est l'ordre de grandeur qui explique ses trois ouvertures et trois levées du
 * 29/09 à 10-20 s près). La porte partage cette cadence entre les deux sources, relectures et pages de liste
 * comprises — dans UN processus : le RUN les collecte dans le même, mais une collecte lancée en parallèle depuis un
 * autre processus (même sortie réseau) s'ajouterait au compteur du pare-feu sans être vue ici. Aucune clé n'en
 * reçoit par précaution : une cadence de trop ralentit une source sans raison.
 */
const PACE_FLOOR_MS: Readonly<Record<string, number>> = {
  'tenant:eightfold': 350,
};

/** L'écart minimal imposé à une clé de limitation, 0 quand l'éditeur n'a pas de seuil mesuré. */
export function paceFloorMs(key: string): number {
  return Object.hasOwn(PACE_FLOOR_MS, key) ? PACE_FLOOR_MS[key] : 0;
}

/** Le hostname observé, conservé séparément pour le diagnostic. */
export function observedHost(url: string): string {
  try { return new URL(url).hostname.toLowerCase(); } catch { return 'url-invalide'; }
}
