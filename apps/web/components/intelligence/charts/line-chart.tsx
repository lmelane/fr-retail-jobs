import { fmtDateShort } from '@/lib/intelligence/format';

/**
 * Courbe / sparkline SVG serveur : une série, encre + un seul vert, grille
 * pointillée, libellés directs (dernière valeur en serif), infobulle par point
 * via `data-tip` (calque client partagé). Aucune animation : rien à réduire.
 */
export type LinePoint = { date: string; value: number };

export function LineChart({
  points,
  format = (v) => String(Math.round(v)),
  baseline,
  compact = false,
  ariaLabel,
}: {
  points: LinePoint[];
  format?: (v: number) => string;
  /** Ligne de référence (ex. : 100 pour un indice). */
  baseline?: number;
  compact?: boolean;
  ariaLabel: string;
}) {
  const W = compact ? 280 : 640;
  const H = compact ? 96 : 220;
  const pad = compact ? { t: 10, r: 44, b: 18, l: 8 } : { t: 16, r: 64, b: 24, l: 40 };
  const values = points.map((p) => p.value).concat(baseline !== undefined ? [baseline] : []);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.max(1, Math.abs(hi) * 0.1);
  const yMin = lo - span * 0.12;
  const yMax = hi + span * 0.12;
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const ticks = compact ? [] : [yMin + (yMax - yMin) * 0.2, yMin + (yMax - yMin) * 0.5, yMin + (yMax - yMin) * 0.8];
  const last = points[points.length - 1];

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
          <text className="axis" x={pad.l - 6} y={y(t) + 4} textAnchor="end">{format(t)}</text>
        </g>
      ))}
      {baseline !== undefined && <line className="baseline" x1={pad.l} x2={W - pad.r} y1={y(baseline)} y2={y(baseline)} />}
      <path className="line" d={d} />
      {points.map((p, i) => (
        <g key={p.date}>
          {!compact && <circle className="dot" cx={x(i)} cy={y(p.value)} r={2.5} />}
          <circle className="dot--hit" cx={x(i)} cy={y(p.value)} r={compact ? 6 : 10} data-tip={`${format(p.value)}\n${fmtDateShort(p.date)}`} />
        </g>
      ))}
      {last && (
        <text className="end" x={x(points.length - 1) + 8} y={y(last.value) + 6} style={compact ? { fontSize: 13 } : undefined}>
          {format(last.value)}
        </text>
      )}
      {!compact && points.length > 0 && (
        <>
          <text className="axis" x={pad.l} y={H - 6}>{fmtDateShort(points[0].date)}</text>
          {points.length > 1 && (
            <text className="axis" x={W - pad.r} y={H - 6} textAnchor="end">{fmtDateShort(last.date)}</text>
          )}
        </>
      )}
    </svg>
  );
}
