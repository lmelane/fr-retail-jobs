import { fmtDateShort, fmtInt } from '@/lib/intelligence/format';

/**
 * Aire empilée SVG serveur : ≤ 4 séries d'un même vert à opacités décroissantes
 * (pas d'arc-en-ciel), libellés directs au bord droit (pas de légende), grille
 * pointillée. Le total est la ligne du haut.
 */
export type StackedPoint = { date: string; values: number[] };
const OPACITY = [0.92, 0.6, 0.34, 0.16];

export function StackedArea({ points, labels, ariaLabel }: { points: StackedPoint[]; labels: string[]; ariaLabel: string }) {
  const W = 640;
  const H = 240;
  const pad = { t: 16, r: 150, b: 24, l: 40 };
  const totals = points.map((p) => p.values.reduce((s, v) => s + v, 0));
  const yMax = Math.max(1, ...totals) * 1.08;
  const x = (i: number) => pad.l + (points.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);
  const n = labels.length;
  // cumul[i][k] = somme des séries 0..k au point i
  const cumul = points.map((p) => p.values.reduce<number[]>((acc, v) => [...acc, (acc[acc.length - 1] ?? 0) + v], []));
  const band = (k: number) => {
    const top = points.map((_, i) => `${x(i).toFixed(1)},${y(cumul[i][k]).toFixed(1)}`);
    const bottom = points.map((_, i) => `${x(i).toFixed(1)},${y(k === 0 ? 0 : cumul[i][k - 1]).toFixed(1)}`).reverse();
    return `M${top.join(' L')} L${bottom.join(' L')} Z`;
  };
  const lastI = points.length - 1;
  const ticks = [0.25, 0.5, 0.75].map((f) => yMax * f);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
          <text className="axis" x={pad.l - 6} y={y(t) + 4} textAnchor="end">{fmtInt(t)}</text>
        </g>
      ))}
      {Array.from({ length: n }, (_, k) => (
        <path key={k} className="area" d={band(k)} style={{ fillOpacity: OPACITY[k] ?? 0.1 }} />
      ))}
      {lastI >= 0 &&
        Array.from({ length: n }, (_, k) => {
          const mid = (cumul[lastI][k] + (k === 0 ? 0 : cumul[lastI][k - 1])) / 2;
          return (
            <text key={k} className="label" x={W - pad.r + 10} y={y(mid) + 4}>
              {labels[k]} · {fmtInt(points[lastI].values[k])}
            </text>
          );
        })}
      {points.map((p, i) => (
        <circle key={p.date} className="dot--hit" cx={x(i)} cy={y(totals[i])} r={10} data-tip={`${fmtInt(totals[i])}\n${fmtDateShort(p.date)} · ${labels.map((l, k) => `${l} ${fmtInt(p.values[k])}`).join(' · ')}`} />
      ))}
      {points.length > 0 && (
        <>
          <text className="axis" x={pad.l} y={H - 6}>{fmtDateShort(points[0].date)}</text>
          {points.length > 1 && <text className="axis" x={W - pad.r} y={H - 6} textAnchor="end">{fmtDateShort(points[lastI].date)}</text>}
        </>
      )}
    </svg>
  );
}
