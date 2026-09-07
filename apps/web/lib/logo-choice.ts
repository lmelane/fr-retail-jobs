/**
 * Choix du meilleur logo entre plusieurs fournisseurs de favicon.
 *
 * Deux critères, mesurés le 2026-09-07 sur les 120 Maisons les plus actives :
 * la TAILLE (un favicon de 16 px agrandi dans la pastille est illisible) et la
 * TRANSPARENCE (un JPEG dessine un carré blanc là où un ICO se fond).
 */

export type LogoCandidate = { width: number; opaque: boolean };

/**
 * Sous 32 px de côté, un favicon agrandi dans la pastille est illisible.
 * 103 Maisons sur 120 servent au moins 32 px ; 11 n'ont que du 16 px
 * (L'Oréal, PVH, URBN, Rituals, Estée Lauder…) et auront leur monogramme.
 */
export const MIN_LOGO_PX = 32;

/**
 * Un JPEG n'a pas de canal alpha : son fond blanc dessine un carré visible
 * dans la pastille. Mesuré sur Ralph Lauren — DuckDuckGo sert un ICO 48 px
 * transparent, Google un JPEG 64 px opaque : prendre le plus grand des deux
 * ajoutait un cadre blanc. Un format opaque ne l'emporte donc que s'il est
 * NETTEMENT plus grand, pas pour quelques pixels.
 */
export const OPAQUE_MUST_EXCEED = 1.5;

/** Le meilleur des deux : la taille décide, la transparence départage. */
export function preferLogo<T extends LogoCandidate>(a: T, b: T): T {
  if (a.opaque !== b.opaque) {
    const transparent = a.opaque ? b : a;
    const opaque = a.opaque ? a : b;
    return opaque.width > transparent.width * OPAQUE_MUST_EXCEED ? opaque : transparent;
  }
  return b.width > a.width ? b : a;
}

/** Le meilleur candidat utilisable, ou `null` → le composant met son monogramme. */
export function bestLogo<T extends LogoCandidate>(candidates: readonly (T | null)[]): T | null {
  const best = candidates.filter((c): c is T => c !== null).reduce<T | null>((a, b) => (a === null ? b : preferLogo(a, b)), null);
  return best && best.width >= MIN_LOGO_PX ? best : null;
}
