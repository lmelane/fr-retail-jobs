'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Barre de progression de navigation (design_2.md §4.12) : un trait vert de 2px
 * en haut de page qui remplace tout spinner. Elle avance dès qu'une navigation
 * change l'URL (pathname ou query) et se retire à l'arrivée.
 *
 * Rendu discret et honnête : c'est un indicateur d'activité, pas une fausse
 * mesure — il monte vite vers ~90% puis se complète à l'arrivée du nouveau rendu.
 * Respecte prefers-reduced-motion (transition ~1ms via la règle globale).
 */
export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = `${pathname}?${searchParams.toString()}`;

  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const firstRender = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Ne pas animer au tout premier rendu (pas de navigation).
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    timers.current.forEach(clearTimeout);
    timers.current = [];

    // Démarre : visible, monte vite vers 90%, puis complète et se retire —
    // le changement de `key` signifie que le nouveau rendu est déjà arrivé.
    setVisible(true);
    setWidth(0);
    timers.current.push(setTimeout(() => setWidth(90), 10));
    timers.current.push(setTimeout(() => setWidth(100), 220));
    timers.current.push(
      setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 500),
    );

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [key]);

  return (
    <div
      className="progress"
      role="presentation"
      aria-hidden
      style={{
        width: `${width}%`,
        opacity: visible ? 1 : 0,
        transition: 'width 200ms cubic-bezier(.645,.045,.355,1), opacity 200ms',
      }}
    />
  );
}
