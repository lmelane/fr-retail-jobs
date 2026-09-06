import Link from 'next/link';
import { LineChart, type LinePoint } from './line-chart';
import { naText, type NotAvailable } from '@/lib/intelligence/format';

/** Petits multiples : une sparkline par entité, libellé direct, n/d daté sinon. */
export function SmallMultiples({ items, format }: { items: { label: string; href?: string; points?: LinePoint[]; na?: NotAvailable }[]; format?: (v: number) => string }) {
  return (
    <div className="grid grid-cols-2 gap-x-10 gap-y-8 md:grid-cols-3">
      {items.map((it) => (
        <div key={it.label} className="rule-soft pt-3">
          <p className="t-caption mb-2">{it.href ? <Link href={it.href} className="u-line">{it.label}</Link> : it.label}</p>
          {it.points && it.points.length >= 2 ? (
            <LineChart points={it.points} compact format={format} baseline={100} ariaLabel={`Indice ${it.label}`} />
          ) : (
            <p className="na">{it.na ? naText(it.na) : 'n/d'}</p>
          )}
        </div>
      ))}
    </div>
  );
}
