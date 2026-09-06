import type { ReactNode } from 'react';
import Link from 'next/link';
import { fmtInt, fmtPct, MIN_SAMPLE } from '@/lib/intelligence/format';

/**
 * Barres horizontales triées : libellé, barre 6 px (vert = série mise en
 * avant, gris = contexte), valeur en serif tabulaire. La part (dérivée)
 * n'apparaît que si le total atteint le seuil ; le compte (fait) toujours.
 */
export type BarRow = { label: ReactNode; value: number; href?: string; sub?: string; muted?: boolean; tip?: string };

export function BarList({ rows, total, compact = false, format = fmtInt }: { rows: BarRow[]; total?: number; compact?: boolean; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const showShare = total !== undefined && total >= MIN_SAMPLE;
  if (rows.length === 0) return <p className="na">Aucune donnée dans ce périmètre.</p>;
  return (
    <div className={`barlist${compact ? ' barlist--compact' : ''}`}>
      {rows.map((r, i) => (
        <div key={i} className="barlist__row" data-tip={r.tip}>
          <span className="barlist__label">
            {r.href ? <Link href={r.href}>{r.label}</Link> : r.label}
            {r.sub && <small>{r.sub}</small>}
          </span>
          <span className="barlist__value">
            {format(r.value)}
            {showShare && (
              <>
                <span className="sr-only">, soit </span>
                <small>{fmtPct(r.value / total, 1)}</small>
              </>
            )}
          </span>
          <span className="barlist__track" aria-hidden>
            <span className={`barlist__fill${r.muted ? ' barlist__fill--muted' : ''}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
