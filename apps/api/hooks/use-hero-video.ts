'use client';

import { useEffect, useState } from 'react';

/**
 * La vidéo de fond du hero doit-elle être RENDUE ?
 *
 * `display: none` masque un `<video>` mais ne l'empêche pas d'être téléchargé :
 * mesuré le 2026-09-07 sur `/`, l'iPhone 13 recevait **4 423 ko de MP4, soit
 * 97,8 % du poids de la page** (4 522 ko contre 53 ko pour les autres pages),
 * y compris sous `prefers-reduced-motion` où la vidéo était ensuite masquée
 * (`readyState=4`, `buffered=37 s`). Seul le non-rendu évite le transfert.
 *
 * Deux refus, pour deux raisons différentes :
 *  - `prefers-reduced-motion` : l'utilisateur a demandé moins de mouvement ;
 *  - petit écran : 4,4 Mo sur un forfait mobile pour un décor, alors que le
 *    poster porte déjà l'image (`background` de la section).
 *
 * Rendu serveur et première peinture : `false`. Le poster s'affiche seul, puis
 * la vidéo prend le relais si les conditions sont réunies — jamais l'inverse,
 * qui ferait clignoter le hero.
 */

/** Sous cette largeur, le poster suffit : le décor ne vaut pas 4,4 Mo. */
const MIN_WIDTH_PX = 768;

export function useHeroVideo(): boolean {
  const [play, setPlay] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const wide = window.matchMedia(`(min-width: ${MIN_WIDTH_PX}px)`);
    const update = () => setPlay(!motion.matches && wide.matches);
    update();
    motion.addEventListener('change', update);
    wide.addEventListener('change', update);
    return () => {
      motion.removeEventListener('change', update);
      wide.removeEventListener('change', update);
    };
  }, []);

  return play;
}
