import type { ReactNode } from 'react';
import Link from 'next/link';
import { IntelNav } from './intel-nav';
import { TipLayer } from './charts/tip-layer';
import { fmtDate, fmtInt, fmtPct, naText, type NotAvailable, MIN_SAMPLE } from '@/lib/intelligence/format';
import type { Coverage as CoverageData } from '@/lib/intelligence/queries/coverage';
import { intelPaths } from '@/lib/intelligence/paths';
import { jsonLd } from '@/lib/intelligence/seo';

/**
 * Chrome partagé des pages Intelligence : enveloppe (sous-nav + calque
 * d'infobulle), tête de page 4+6, ligne de couverture, niveau FACT / DERIVED /
 * INSIGHT, tuile KPI, bloc de section, lecture Catwalks, mix, JSON-LD.
 * Composants serveur : aucune interactivité ici.
 */

export type Level = 'fact' | 'fact-shares' | 'derived' | 'insight';
/** « fact-shares » : des comptes observés accompagnés de parts (dérivées) — dit tel quel (audit I-1). */
const LEVEL_TEXT: Record<Level, string> = { fact: 'Fait observé', 'fact-shares': 'Fait observé · parts dérivées', derived: 'Métrique dérivée', insight: 'Lecture Catwalks' };

export function LevelTag({ level }: { level: Level }) {
  return <span className={`t-caption-soft lvl${level === 'insight' ? ' lvl--insight' : ''}`}>{LEVEL_TEXT[level]}</span>;
}

export function IntelPage({ children }: { children: ReactNode }) {
  return (
    <main className="page bg-paper">
      <div className="container">
        <IntelNav />
      </div>
      {children}
      <TipLayer />
    </main>
  );
}

export function PageHead({ eyebrow = 'Catwalks Intelligence', title, lede, crumbs }: { eyebrow?: string; title: ReactNode; lede?: ReactNode; crumbs?: { name: string; path: string }[] }) {
  return (
    <header className="container page-head">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Fil d'Ariane" className="crumbs t-caption-soft">
          {crumbs.map((c) => (
            <span key={c.path}>
              <Link href={c.path} className="u-line">{c.name}</Link>
            </span>
          ))}
        </nav>
      )}
      <div className="g12">
        <div className="c4">
          <p className="t-caption green mb-3">{eyebrow}</p>
          <h1 className="t-page">{title}</h1>
        </div>
        {lede && <div className="s5 t-body soft self-end max-w-[60ch]">{lede}</div>}
      </div>
    </header>
  );
}

/** « N offres analysées · N Maisons · N pays · historique depuis le … · mis à jour … » */
export function Coverage({ coverage, jobs }: { coverage: CoverageData; jobs?: number }) {
  const n = jobs ?? coverage.jobs;
  return (
    <p className="coverage t-caption-soft rule">
      <span>{fmtInt(n)} offres analysées</span>
      <span>{fmtInt(coverage.companies)} Maisons</span>
      <span>{fmtInt(coverage.countries)} pays</span>
      <span>
        {coverage.hasSnapshots ? `historique depuis le ${fmtDate(coverage.historyStart)}` : `historique dès le ${fmtDate(coverage.historyStart)}`}
      </span>
      {coverage.updatedAt && <span>mis à jour le {fmtDate(coverage.updatedAt)}</span>}
      <span>
        <Link href={intelPaths.methodology} className="u-line text-ink">Méthodologie</Link>
      </span>
    </p>
  );
}

export function NA({ na }: { na: NotAvailable }) {
  return <span className="na">{naText(na)}</span>;
}

export function Kpi({ label, value, na, level, sub, green }: { label: string; value?: string; na?: NotAvailable; level: Level; sub?: string; green?: boolean }) {
  return (
    <div className="kpi rule">
      <span className="t-caption">{label}</span>
      {value !== undefined ? (
        <span className={`kpi__value${green ? ' kpi__value--green' : ''}`}>{value}</span>
      ) : (
        <span className="kpi__na">{na ? naText(na) : 'n/d'}</span>
      )}
      {sub && <span className="t-body2 kpi__sub">{sub}</span>}
      <LevelTag level={level} />
    </div>
  );
}

export function Block({ id, title, level, children, more, className }: { id: string; title: ReactNode; level: Level; children: ReactNode; more?: { href: string; label: string }; className?: string }) {
  return (
    <section id={id} className={`iblock rule ${className ?? ''}`} aria-labelledby={`${id}-title`}>
      <div className="iblock__head">
        <div>
          <h2 id={`${id}-title`} className="t-d2">{title}</h2>
          <LevelTag level={level} />
        </div>
        {more && (
          <Link href={more.href} className="t-caption u-line text-ink">
            {more.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Une phrase d'interprétation, toujours calculée depuis les données affichées. */
export function Insight({ children }: { children: ReactNode }) {
  return (
    <div className="insight">
      <LevelTag level="insight" />
      <p className="mt-2">{children}</p>
    </div>
  );
}

/** Répartition : part (dérivée, seuil 30) + compte (fait). */
export function Mix({ rows, total, label = 'offres' }: { rows: { label: ReactNode; count: number; href?: string }[]; total: number; label?: string }) {
  const showPct = total >= MIN_SAMPLE;
  return (
    <div className="mix">
      {rows.map((r, i) => (
        <div key={i} className="mix__row">
          <span className="truncate">{r.href ? <Link href={r.href} className="u-line">{r.label}</Link> : r.label}</span>
          <span className="pct">{showPct && total > 0 ? fmtPct(r.count / total, 1) : <span className="na">n/d</span>}</span>
          <span className="n">{fmtInt(r.count)}</span>
        </div>
      ))}
      {!showPct && <p className="t-caption-soft mt-2">Parts non affichées : moins de {MIN_SAMPLE} {label}.</p>}
    </div>
  );
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}

/** Bloc réservé au lot W2 : jamais de texte inventé, seulement la date de disponibilité. */
export function Placeholder({ text }: { text: string }) {
  return <p className="na">{text}</p>;
}
