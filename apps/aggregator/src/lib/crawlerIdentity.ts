/**
 * L'IDENTITÉ DU COLLECTEUR — décision propriétaire D62 du 2026-09-13.
 *
 * L'opérateur est **Catwalks**, pas le produit. « Mode Careers » est une marque de surface ; l'entité qu'un
 * éditeur ou une Maison doit pouvoir contacter est Catwalks, et c'est elle que le User-Agent doit nommer.
 *
 * Cette identité vaut sur TOUS les modes de collecte — API, JSON, XML, RSS, sitemap, HTML, navigateur
 * automatisé, rendu JavaScript — parce qu'une identité vraie sur un chemin et fausse sur un autre n'est pas
 * une identité.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────
 * CE QU'ON N'EMPRUNTE JAMAIS
 *
 * `api.smartrecruiters.com` sert `User-agent: LinkedInBot / Allow: /v1/companies/` puis
 * `User-agent: * / Disallow: /`. Se déclarer LinkedInBot pour tomber dans l'exception serait techniquement
 * efficace et **interdit** : la présence de cette ligne signifie seulement que l'éditeur a nommé LinkedIn,
 * jamais qu'il nous a accordé quoi que ce soit.
 *
 * Notre droit d'accès repose sur l'autorisation du propriétaire et sur la nature publique des offres — jamais
 * sur l'identité technique d'un tiers. Une preuve qui affirmerait le contraire serait fausse.
 */

/**
 * L'URL publique qui décrit le robot. **Elle doit répondre 200 tant que le robot tourne.**
 *
 * L'opérateur est Catwalks, pas « Mode Careers » : c'est donc `catwalks.io` que le User-Agent nomme, et
 * cette URL-là ne se déplace pas sur le domaine du produit pour la commodité du déploiement — un
 * User-Agent qui nommerait le produit désignerait la mauvaise entité responsable.
 *
 * ÉTAT RÉEL, à ne pas masquer : cette page n'est **pas encore servie** (404 mesuré le 2026-09-14).
 * `catwalks.io` est un autre dépôt, que celui-ci ne déploie pas. D62 fait de sa mise en ligne un
 * **préalable bloquant à l'activation** — le contenu à publier est rédigé et versionné ici
 * (`apps/web/app/bot/page.tsx`, à porter sur catwalks.io), et `botInfoUrlIsServed()` ci-dessous permet à un
 * contrôle de le vérifier plutôt que de le supposer.
 */
export const BOT_INFO_URL = 'https://catwalks.io/bot';

/** Le User-Agent officiel, unique, non surchargeable par une variable d'environnement. */
export const CRAWLER_IDENTITY = `CatwalksBot/1.0 (+${BOT_INFO_URL})`;

/**
 * L'URL d'information est-elle réellement servie ?
 *
 * Le préalable de D62 est vérifiable, donc il doit être vérifié : tant que ceci rend `false`, l'identité
 * annoncée ne mène nulle part et un éditeur qui lit `CatwalksBot` dans ses journaux ne peut pas nous
 * joindre. *Un préalable qu'on ne mesure pas est un préalable qu'on suppose tenu.*
 */
export async function botInfoUrlIsServed(timeoutMs = 10_000): Promise<boolean> {
  try {
    const res = await fetch(BOT_INFO_URL, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    return res.status === 200;
  } catch {
    return false;
  }
}
