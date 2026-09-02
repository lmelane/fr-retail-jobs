'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Check,
  ChevronDown,
  Layers,
  Loader2,
  MapPin,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { JobDetail } from '@/components/job-detail';
import { SearchPill } from '@/components/search-pill';
import { contractLabel, relativeDate } from '@/lib/format';
import { countryLabel } from '@/lib/countries';
import { cn } from '@/lib/utils';
import type { JobFilters, JobRow, JobsResult } from '@/lib/jobs';

/**
 * A jobboard, shaped like Indeed with the Catwalks brand.
 *
 * Three rules the layout follows, each of them a fix for something that was
 * wrong before:
 *
 *  - Search state lives in the URL. Filtering, paging and searching are server
 *    round-trips, so a result set can be linked and Back walks through searches.
 *  - Filters sit in the open as real dropdowns, not a native <details> that
 *    hijacks text selection. A filter you cannot see is a filter you forget is
 *    applied.
 *  - The list and the selected offer's detail are the two panes of a single
 *    result page, Indeed-style — not a list beside a permanent map. The right
 *    pane always shows a detail when there are results (the first offer by
 *    default), and a small location map lives INSIDE that detail, scoped to
 *    the one offer being read.
 */

const SECTOR_LABELS: Record<string, string> = {
  FASHION: 'Mode',
  LUXURY: 'Luxe',
  BEAUTY: 'Beauté',
  JEWELRY_WATCHES: 'Joaillerie',
  RETAIL: 'Retail',
  SUPPLIER: 'Fournisseurs',
  MEDIA_AGENCY: 'Médias',
  RECRUITER: 'Cabinets',
  // Employers the reference list does not name — enseignes reached through a
  // jobboard rather than their own ATS. "UNKNOWN" read as a bug; the offers are
  // real, they simply sit outside the 728-house list.
  OTHER: 'Hors référentiel',
  UNKNOWN: 'Hors référentiel',
};

/** URL keys, in French, because the URL is user-visible. */
const PARAM: Record<string, string> = {
  q: 'q',
  city: 'ville',
  contract: 'contrat',
  sector: 'secteur',
  maison: 'maison',
  group: 'groupe',
  source: 'source',
  country: 'pays',
  page: 'page',
};

/** Country codes -> French labels for the Pays filter, built from countries.ts. */
const COUNTRY_LABELS: Record<string, string> = Object.fromEntries(
  ['FR', 'US', 'GB', 'IT', 'ES', 'DE', 'NL', 'BE', 'PT', 'CA', 'CH', 'CN', 'AU',
   'DK', 'NO', 'SE', 'KR', 'JP', 'MX', 'MY', 'AE', 'HK', 'SG'].map((c) => [c, countryLabel(c)]),
);

/** Registry keys are lowercase slugs; show the employer-facing label instead. */
const SOURCE_LABELS: Record<string, string> = {
  richemont: 'Richemont',
  kering: 'Kering',
  loreal: "L'Oréal",
  courir: 'Courir',
  lvmh: 'LVMH',
  wttj: 'Welcome to the Jungle',
  fashionjobs: 'FashionJobs',
  puig: 'Puig',
  chanel: 'Chanel',
  dior: 'Dior',
  sephora: 'Sephora',
  lacoste: 'Lacoste',
  'galeries-lafayette': 'Galeries Lafayette',
  decathlon: 'Decathlon',
};

export function JobsView({ data, filters }: { data: JobsResult; filters: JobFilters }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(filters.q ?? '');
  const [locationDraft, setLocationDraft] = useState(filters.city ?? '');
  // Indeed always shows a detail when there are results: default to the
  // first offer rather than an empty right pane on first paint.
  const [selectedId, setSelectedId] = useState<string | null>(data.jobs[0]?.id ?? null);

  /**
   * Infinite scroll, Indeed-style: page 1 arrives server-rendered in `data`
   * (SEO, first paint); scrolling near the bottom fetches page 2+ from
   * /api/jobs and appends it here. `jobs` is the list actually shown — the
   * one thing that must stay in lockstep with it is `page`/`pageCount`, so
   * "stop when exhausted" and "resume after a new search" both stay correct.
   */
  const [jobs, setJobs] = useState<JobRow[]>(data.jobs);
  const [loadedPage, setLoadedPage] = useState(data.page);
  const [pageCount, setPageCount] = useState(data.pageCount);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);

  /**
   * The header (nav + search pill + filter row) is `sticky top-0`, Indeed's
   * fixed filter bar equivalent. Its height varies (it wraps to two rows
   * below lg), so the sticky detail column measures it live rather than
   * hardcoding a magic offset — that offset is what keeps the detail's `top`
   * and internal scroll cutoff honest as the header reflows.
   */
  const headerRef = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useEffect(() => {
    const node = headerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height !== undefined) setHeaderHeight(height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A new server render — a new search or filter — replaces the accumulated
  // list rather than appending to it: `data.jobs` changing IS "start over".
  useEffect(() => {
    setJobs(data.jobs);
    setLoadedPage(data.page);
    setPageCount(data.pageCount);
    setLoadError(null);
  }, [data.jobs, data.page, data.pageCount]);

  // A fresh search invalidates the selection: the previously selected offer
  // may no longer be in the list. Indeed always shows a detail when there are
  // results, so the first offer is selected by default rather than leaving
  // the right pane empty until a candidate clicks something.
  useEffect(() => setSelectedId(data.jobs[0]?.id ?? null), [data.jobs]);
  useEffect(() => setDraft(filters.q ?? ''), [filters.q]);
  useEffect(() => setLocationDraft(filters.city ?? ''), [filters.city]);

  const selected = jobs.find((job) => job.id === selectedId) ?? null;

  /**
   * Fetches the next page from /api/jobs and appends it. Reads the CURRENT
   * URL's filters (not `filters` from props, which only reflects the initial
   * server render) so a filter applied without a full navigation — there is
   * none today, but this keeps the fetch honest about the live URL either way.
   */
  const loadMore = useCallback(async () => {
    if (loadingMore || loadedPage >= pageCount) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const next = new URLSearchParams(params.toString());
      next.set('page', String(loadedPage + 1));
      const response = await fetch(`/api/jobs?${next.toString()}`);
      if (!response.ok) throw new Error(`Le serveur a répondu ${response.status}.`);
      const result = (await response.json()) as JobsResult;
      setJobs((current) => [...current, ...result.jobs]);
      setLoadedPage(result.page);
      setPageCount(result.pageCount);
    } catch {
      // Never fail silently: the sentinel stays in view, so without this the
      // candidate would see the list simply stop growing with no explanation.
      setLoadError('Le chargement des offres suivantes a échoué.');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loadedPage, pageCount, params]);

  // The sentinel sits after the last card; once it enters the viewport (or
  // comes within 400px of it) the next page loads — no click, Indeed-style.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: '400px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  /**
   * Writes one filter to the URL. Any change but paging returns to page 1 —
   * staying on page 7 of a narrower search would land on an empty page.
   */
  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in changes)) next.delete('page');
    startTransition(() =>
      router.push(next.toString() ? `/emplois?${next}` : '/emplois', { scroll: false }),
    );
  };

  /** Clicking an active value clears it, so each control is its own toggle. */
  const toggle = (key: string, value: string) =>
    navigate({ [key]: params.get(key) === value ? null : value });

  const activeCount = Object.values(PARAM).filter(
    (key) => key !== 'page' && params.get(key),
  ).length;

  return (
    <div className="bg-background">
      {/* ============ Header: brand + the big Indeed-style search pill ============
          `sticky top-0`: the whole search+filter header stays pinned while the
          page scrolls under it — Indeed itself pins only the filter bar (its
          header scrolls away), but pinning the pill along with it is the clean
          equivalent: the candidate can always search or refine a filter without
          scrolling back up. A solid background + bottom border keeps the list
          from visually running through it. */}
      <header ref={headerRef} className="border-border/70 sticky top-0 z-40 border-b bg-white">

        {/* Wraps to two rows below lg (logo/nav, then the full-width search
            pill) rather than forcing everything onto one row and pushing the
            pill off-screen — Indeed itself stacks the same way, §6. */}
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <nav className="flex shrink-0 items-center gap-5">
            <Link
              href="/emplois"
              aria-current="page"
              className="text-foreground border-primary -mb-[13px] border-b-2 pb-3 text-[15px] font-semibold"
            >
              Offres
            </Link>
            <Link
              href="/entreprises"
              className="text-foreground/70 hover:text-foreground pb-3 text-[15px] font-medium transition-colors"
            >
              Entreprises
            </Link>
          </nav>

          <div className="text-muted-foreground order-2 ml-auto flex shrink-0 items-center gap-3 text-xs font-medium tabular-nums lg:order-3">
            <span aria-live="polite">
              {pending ? 'Recherche…' : `${data.total.toLocaleString('fr-FR')} offres`}
            </span>
            {activeCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startTransition(() => router.push('/emplois', { scroll: false }))}
                className="hover:bg-surface h-8 rounded-full px-3 text-xs"
              >
                <X className="size-4" />
                Effacer
              </Button>
            )}
          </div>

          {/* The pill: Poste | Lieu | Rechercher, Indeed §3.2 proportions,
              with live autocomplete on both fields — shared with the landing
              page's own pill so the two never diverge (see SearchPill). */}
          <div className="order-3 w-full lg:order-2">
            <SearchPill
              query={draft}
              onQueryChange={setDraft}
              city={locationDraft}
              onCityChange={setLocationDraft}
              onSubmit={({ query, city }) => navigate({ q: query || null, ville: city || null })}
            />
          </div>
        </div>

        {/* ============ Filters: real dropdowns, click-driven, not <details> ============ */}
        <div className="mx-auto flex max-w-[1280px] items-center gap-2 overflow-x-auto px-6 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterMenu
            label="Pays"
            active={params.get('pays')}
            options={data.facets.countries}
            labels={COUNTRY_LABELS}
            onSelect={(value) => toggle('pays', value)}
          />
          <FilterMenu
            label="Secteur"
            active={params.get('secteur')}
            options={data.facets.sectors}
            labels={SECTOR_LABELS}
            onSelect={(value) => toggle('secteur', value)}
          />
          <FilterMenu
            label="Contrat"
            active={params.get('contrat')}
            options={data.facets.contracts}
            onSelect={(value) => toggle('contrat', value)}
          />
          <FilterMenu
            label="Ville"
            active={params.get('ville')}
            options={data.facets.cities}
            onSelect={(value) => toggle('ville', value)}
          />
          <FilterMenu
            label="Maison"
            active={params.get('maison')}
            options={data.facets.maisons}
            onSelect={(value) => toggle('maison', value)}
          />
          <FilterMenu
            label="Groupe"
            active={params.get('groupe')}
            options={data.facets.groups}
            onSelect={(value) => toggle('groupe', value)}
          />
          <FilterMenu
            label="Source"
            active={params.get('source')}
            options={data.facets.sources}
            labels={SOURCE_LABELS}
            onSelect={(value) => toggle('source', value)}
          />
        </div>
      </header>

      {/* ============ Body: list left, selected offer's detail fills the right column — Indeed layout ============
          The page itself scrolls (no fixed-height app shell): the list is a
          normal-flow column, and the detail column is `sticky` under the
          pinned header so it stays in view while the list scrolls past it —
          exactly how fr.indeed.com/jobs behaves. Below lg there is no room for
          two columns, so the list and the detail take turns — selecting a
          card swaps the list out for the detail, and a back button (also
          below lg) swaps it back. */}
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,470px)_minmax(0,1fr)] lg:items-start">
        <div className={cn(selected ? 'hidden lg:block' : 'block')}>
          {jobs.length === 0 ? (
            <EmptyState
              hasFilters={activeCount > 0}
              onReset={() => startTransition(() => router.push('/emplois', { scroll: false }))}
            />
          ) : (
            <ul className={cn('flex flex-col gap-2 pb-2 transition-opacity', pending && 'opacity-50')}>
              {jobs.map((job) => (
                <li key={job.id}>
                  <JobCard
                    job={job}
                    onSelect={() => setSelectedId(job.id)}
                    isSelected={selected?.id === job.id}
                  />
                </li>
              ))}

              {/* Infinite scroll, Indeed-style: this sentinel triggers the
                  next page 400px before it would actually be reached, so
                  the next cards are usually ready before the candidate
                  scrolls into the gap. Rendered inside the same <ul> so it
                  never desyncs from the list it is the tail of — and it
                  still works with page scroll, the IntersectionObserver
                  only needs the sentinel to enter the viewport. */}
              {loadedPage < pageCount && (
                <li ref={sentinelRef} aria-hidden={!loadingMore} className="grid place-items-center py-4">
                  {loadingMore && (
                    <span className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                      Chargement…
                    </span>
                  )}
                </li>
              )}

              {loadError && (
                <li className="grid place-items-center gap-2 py-4 text-center">
                  <p className="text-muted-foreground text-sm">{loadError}</p>
                  <Button variant="ghost" size="sm" onClick={() => void loadMore()} className="rounded-full">
                    Réessayer
                  </Button>
                </li>
              )}
            </ul>
          )}
        </div>

        {selected && (
          <div
            className="border-border bg-card relative flex flex-col overflow-hidden rounded-[20px] border lg:sticky lg:top-(--detail-top) lg:max-h-(--detail-max-height)"
            style={
              headerHeight
                ? ({
                    '--detail-top': `${headerHeight + 16}px`,
                    '--detail-max-height': `calc(100vh - ${headerHeight + 32}px)`,
                  } as React.CSSProperties)
                : undefined
            }
          >
            {/* Back to the list — only meaningful below lg, where the detail
                covers the whole column; at lg+ both panes are always visible
                so there is nothing to go "back" from. */}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelectedId(null)}
              aria-label="Retour à la liste des offres"
              className="hover:bg-surface absolute top-3 right-3 z-10 rounded-full lg:hidden"
            >
              <X className="size-4" />
            </Button>
            <JobDetail job={selected} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A dropdown of facet values with their counts.
 *
 * A real button + panel: it closes on outside click and on Escape, and it
 * never hijacks a click as a text selection the way a native <details>/
 * <summary> can. The panel renders through a portal at a measured, fixed
 * position rather than as an absolutely-positioned child — the filter row it
 * lives in scrolls horizontally (`overflow-x-auto`), and CSS has no way to
 * clip one axis of a container while leaving the other open, so a plain
 * `absolute` panel was clipped by that same scroll box.
 */
function FilterMenu({
  label,
  active,
  options,
  labels,
  onSelect,
}: {
  label: string;
  active: string | null;
  options: { value: string; count: number }[];
  labels?: Record<string, string>;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const place = () => {
      const box = buttonRef.current?.getBoundingClientRect();
      if (box) setRect({ top: box.bottom + 4, left: box.left });
    };
    place();

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    // The trigger sits in a horizontally scrolling row: reposition on scroll
    // and resize so the panel tracks it instead of drifting away.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  if (options.length === 0) return null;
  const display = (value: string) => labels?.[value] ?? value;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium transition-colors',
          active
            ? 'border-primary/30 bg-secondary-container text-on-secondary-container font-semibold'
            : 'border-border bg-white text-foreground hover:bg-surface',
        )}
      >
        {active ? display(active) : label}
        <ChevronDown className={cn('size-4 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>

      {open && rect && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={label}
            style={{ top: rect.top, left: rect.left }}
            className="border-border/60 fixed z-50 max-h-80 w-64 overflow-y-auto rounded-xl border bg-white p-1.5 shadow-[0_0_2px_0_rgba(45,45,45,.16),0_4px_8px_0_rgba(45,45,45,.08),0_8px_16px_0_rgba(45,45,45,.04)]"
          >
            {options.map((option) => {
              const isActive = option.value === active;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    setOpen(false);
                    onSelect(option.value);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    isActive ? 'bg-secondary-container text-on-secondary-container font-semibold' : 'hover:bg-surface',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2 truncate">
                    {isActive && <Check className="size-3.5 shrink-0" />}
                    <span className="truncate">{display(option.value)}</span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {option.count.toLocaleString('fr-FR')}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

function JobCard({
  job,
  onSelect,
  isSelected,
}: {
  job: JobRow;
  onSelect: () => void;
  isSelected: boolean;
}) {
  const contract = contractLabel(job.contract);
  const salary = shortSalary(job);
  const remote = job.remote?.toLowerCase().includes('télé') || job.remote?.toLowerCase().includes('remote')
    ? 'Télétravail'
    : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isSelected ? 'true' : undefined}
      className={cn(
        // Indeed JobCard: a thin-bordered card with a small radius, tight
        // padding and NO employer logo — the title leads the scan. Selection is
        // a thin brand border over a faint tint, not a heavy border + shadow.
        'w-full rounded-xl border px-4 py-3 text-left transition-colors',
        isSelected
          ? 'border-primary bg-secondary-container/40'
          : 'border-border bg-white hover:bg-surface',
      )}
    >
      {/* Title leads (Indeed puts no logo on list cards), then employer + city. */}
      <h3 className="text-foreground line-clamp-2 text-[18px] leading-[24px] font-bold tracking-[-0.01em]">
        {job.title}
      </h3>
      <p className="text-muted-foreground mt-1 truncate text-[13px]">{job.company}</p>
      {job.city && (
        <p className="text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-[13px]">
          <MapPin className="size-3 shrink-0 opacity-70" />
          {job.city}
        </p>
      )}

      {/* Attribute chips, Indeed order: salary, contract, remote. */}
      {(salary || contract || remote) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {salary && <Attr>{salary}</Attr>}
          {contract && <Attr tone={contract === 'CDI' ? 'success' : 'neutral'}>{contract}</Attr>}
          {remote && <Attr>{remote}</Attr>}
        </div>
      )}

      {(job.postedAt || job.sourceCount > 1) && (
        <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
          {job.postedAt && <span>{relativeDate(job.postedAt)}</span>}
          {job.sourceCount > 1 && (
            <span className="flex items-center gap-1">
              <Layers className="size-3 opacity-70" />
              {job.sourceCount} sources
            </span>
          )}
        </p>
      )}
    </button>
  );
}

/** A small attribute chip, Indeed-style: 12px, radius 8, tinted by tone. */
function Attr({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' }) {
  return (
    <span
      className={cn(
        'rounded-lg px-2 py-1 text-[12px] font-bold leading-none',
        tone === 'success'
          ? 'bg-success-surface text-success'
          : 'bg-surface-high text-foreground/75',
      )}
    >
      {children}
    </span>
  );
}

/** Compact salary for a card chip: "35 k€ – 42 k€", or a single figure. */
function shortSalary(job: JobRow): string | null {
  if (job.salaryMin === null && job.salaryMax === null) return null;
  const k = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)} k€` : `${v} €`);
  const min = job.salaryMin;
  const max = job.salaryMax;
  if (min !== null && max !== null && min !== max) return `${k(min)} – ${k(max)}`;
  return k((min ?? max) as number);
}

function EmptyState({ hasFilters, onReset }: { hasFilters: boolean; onReset: () => void }) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div>
        <p className="text-foreground text-sm font-medium">Aucune offre ne correspond.</p>
        {hasFilters && (
          <Button onClick={onReset} variant="ghost" className="mt-3 rounded-full">
            Effacer les filtres
          </Button>
        )}
      </div>
    </div>
  );
}
