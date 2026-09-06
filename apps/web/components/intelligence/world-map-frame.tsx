'use client';

import { useState, type ReactNode } from 'react';
import { MAP_HEIGHT, MAP_WIDTH } from '@/lib/intelligence/geo';

/**
 * Cadre client de la carte : le seul état est le mode (volume / nouvelles
 * 30 j), posé en attribut sur le SVG — les chemins et leurs deux couleurs sont
 * rendus côté serveur (`WorldMap`) et passés en enfants.
 */
export function WorldMapFrame({ children, legend }: { children: ReactNode; legend: ReactNode }) {
  const [mode, setMode] = useState<'volume' | 'new30'>('volume');
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="wmap-toggle" role="group" aria-label="Mode de la carte">
          <button type="button" aria-pressed={mode === 'volume'} onClick={() => setMode('volume')}>Volume</button>
          <button type="button" aria-pressed={mode === 'new30'} onClick={() => setMode('new30')}>Nouvelles offres · 30 j</button>
        </div>
        {legend}
      </div>
      <svg className="wmap" data-mode={mode} viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label="Carte du monde des offres actives, par pays">
        {children}
      </svg>
    </div>
  );
}
