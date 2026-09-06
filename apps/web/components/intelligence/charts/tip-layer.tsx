'use client';

import { useEffect, useState } from 'react';

/**
 * Infobulle unique par page : écoute les survols de tout élément portant
 * `data-tip` (points de courbe, pays de la carte, barres) et l'affiche près du
 * pointeur. Le contenu est du texte (sauts de ligne autorisés) — jamais du
 * HTML. Un seul composant client pour tous les graphiques serveur.
 */
export function TipLayer() {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const find = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null);
    const onMove = (e: PointerEvent) => {
      const el = find(e.target);
      if (!el) {
        setTip((t) => (t ? null : t));
        return;
      }
      const text = el.getAttribute('data-tip') ?? '';
      setTip({ x: e.clientX, y: e.clientY, text });
    };
    const onLeave = () => setTip(null);
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerdown', onLeave);
    window.addEventListener('scroll', onLeave, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerdown', onLeave);
      window.removeEventListener('scroll', onLeave);
    };
  }, []);

  if (!tip) return null;
  const [first, ...rest] = tip.text.split('\n');
  const left = Math.min(tip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1440) - 280);
  const top = tip.y + 16;
  return (
    <div className="tip" role="status" aria-live="polite" style={{ left, top }}>
      <b>{first}</b>
      {rest.join('\n')}
    </div>
  );
}
