'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Reveal au scroll — reproduit le système de corporate.lacoste.com :
 * chaque [data-stagger-index] reçoit .revealed quand il entre dans le
 * viewport (une seule fois), le délai de stagger étant porté par le CSS.
 * html.anim-ready garantit que rien n'est masqué tant que le JS n'a pas
 * tourné (SEO / no-JS safe). Re-scanne à chaque navigation App Router.
 */
export function RevealOnScroll() {
  const pathname = usePathname();

  useEffect(() => {
    document.documentElement.classList.add('anim-ready');
    const targets = document.querySelectorAll('[data-stagger-index]:not(.revealed)');
    if (targets.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            io.unobserve(entry.target);
          }
        }
      },
      // Marge haute très large : un élément déjà dépassé (saut d'ancre,
      // restauration de scroll) reste « intersectant » et se révèle quand même.
      { rootMargin: '10000px 0px -10% 0px' },
    );
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);

  return null;
}
