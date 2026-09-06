import { countryPaths } from '@/lib/intelligence/geo';
import { countryLabel } from '@/lib/countries';
import { fmtInt } from '@/lib/intelligence/format';
import { intelPaths } from '@/lib/intelligence/paths';
import { WorldMapFrame } from './world-map-frame';

/**
 * Choroplèthe SVG rendue côté serveur. Séquentiel une teinte : cinq paliers
 * du vert (quantiles des pays qui ont au moins une offre), via `color-mix` sur
 * les tokens — la DA reste la source de la couleur. Pays sans offre en
 * paper-alt. Clic = page pays. Deux couleurs par pays (volume / nouvelles
 * 30 j) en variables ; le mode est un attribut posé par le cadre client.
 */
const LEVELS = [14, 30, 50, 72, 100];
const mix = (pct: number) => `color-mix(in oklab, var(--fa-green) ${pct}%, var(--fa-green-tint))`;

/** Seuils de quantiles (5 paliers) sur les valeurs strictement positives. */
export function thresholds(values: number[]): number[] {
  const v = [...new Set(values.filter((x) => x > 0))].sort((a, b) => a - b);
  if (v.length === 0) return [];
  return [0.2, 0.4, 0.6, 0.8].map((q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]);
}

export function level(value: number, th: number[]): number {
  if (value <= 0) return -1;
  let l = 0;
  for (const t of th) if (value > t) l += 1;
  return Math.min(l, LEVELS.length - 1);
}

export function WorldMap({ data }: { data: { code: string; active: number; new30: number }[] }) {
  const byCode = new Map(data.map((d) => [d.code, d]));
  const thV = thresholds(data.map((d) => d.active));
  const thN = thresholds(data.map((d) => d.new30));
  const paths = countryPaths();

  const legend = (
    <div className="wmap-legend t-caption-soft" aria-hidden>
      <span>moins</span>
      {LEVELS.map((p) => (
        <i key={p} style={{ background: mix(p) }} />
      ))}
      <span>plus</span>
      <i style={{ background: 'var(--fa-paper-alt)', marginLeft: 8 }} />
      <span>sans offre</span>
    </div>
  );

  return (
    <WorldMapFrame legend={legend}>
      {paths.map((p) => {
        const d = p.code ? byCode.get(p.code) : undefined;
        if (!d || d.active <= 0) return <path key={p.id} d={p.d} />;
        const lv = level(d.active, thV);
        const ln = level(d.new30, thN);
        const style = {
          '--fv': mix(LEVELS[Math.max(0, lv)]),
          '--fn': ln < 0 ? 'var(--fa-paper-alt)' : mix(LEVELS[ln]),
        } as React.CSSProperties;
        const label = countryLabel(d.code);
        return (
          <a key={p.id} href={intelPaths.country(d.code)} aria-label={`${label} : ${fmtInt(d.active)} offres`}>
            <path d={p.d} data-has="1" style={style} data-tip={`${label}\n${fmtInt(d.active)} offres actives · ${fmtInt(d.new30)} nouvelles (30 j)`} />
          </a>
        );
      })}
    </WorldMapFrame>
  );
}
