import { fmtDate, fmtIndex, naText, type NotAvailable } from '@/lib/intelligence/format';

/**
 * Jauge d'indice base 100 : un rail, le repère 100, la marque verte à la
 * valeur. Sans historique, la jauge dit « base 100 le <date> » et pourquoi.
 */
export function IndexGauge({ value, na, baseDate, range = [80, 120], ariaLabel }: { value: number | null; na?: NotAvailable; baseDate: string; range?: [number, number]; ariaLabel: string }) {
  const W = 320;
  const H = 56;
  const [lo, hi] = range;
  const x = (v: number) => 12 + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (W - 24);
  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} style={{ maxWidth: 360 }}>
        <line className="gauge__track" x1={12} x2={W - 12} y1={30} y2={30} />
        <line className="gauge__base" x1={x(100)} x2={x(100)} y1={20} y2={40} />
        <text className="axis" x={12} y={52}>{lo}</text>
        <text className="axis" x={x(100)} y={14} textAnchor="middle">100</text>
        <text className="axis" x={W - 12} y={52} textAnchor="end">{hi}</text>
        {value !== null && (
          <>
            <circle className="gauge__mark" cx={x(value)} cy={30} r={6} data-tip={`${fmtIndex(value)}\nbase 100 le ${fmtDate(baseDate)}`} />
            <text className="end" x={x(value)} y={52} textAnchor="middle" style={{ fontSize: 16 }}>{fmtIndex(value)}</text>
          </>
        )}
      </svg>
      <p className="t-caption-soft mt-1">
        {value !== null ? `Base 100 le ${fmtDate(baseDate)}` : `Base 100 le ${fmtDate(baseDate)}${na ? ` — ${naText(na)}` : ''}`}
      </p>
    </div>
  );
}
