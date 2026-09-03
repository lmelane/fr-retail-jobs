'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { JobDetail } from '@/components/job-detail';
import { SearchPill } from '@/components/search-pill';
import { contractLabel, displayTitle, relativeDate } from '@/lib/format';
import { offerPath } from '@/lib/offer-url';
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
  // The location field is empty when no city is filtered (its placeholder reads
  // "Ville, région ou pays"), and the real city otherwise. World by default now
  // (revises D12), so pre-filling "France" would misstate the scope.
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
    <main className="bg-paper pt-(--header-h)">
      {/* Barre de recherche + filtres, sticky sous le header fixe (§5.2, réf
          emplois.html). Le pt du parent = hauteur du header global fixe, pour
          que la barre sticky (top:var(--header-h)) ne recouvre pas la liste.
          Filet pointillé bas via .rule-b. */}
      <header ref={headerRef} className="searchbar">
        {/* rule-b sur le container (pas full-bleed) : même largeur que les filets
            du header, fidèle à emplois.html. */}
        <div className="container-wide rule-b pb-3">
          <SearchPill
            query={draft}
            onQueryChange={setDraft}
            city={locationDraft}
            onCityChange={setLocationDraft}
            onSubmit={({ query, city }) =>
              navigate({
                q: query || null,
                ville: city?.trim() || null,
              })
            }
          />

          {/* ============ Filtres : pills DA (§4.3), dropdowns click-driven ============ */}
          <div className="filters">
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
            {/* No "Source" filter in the front: our aggregation sources are
                internal plumbing (which ATS a posting came from), not something
                a candidate should see or filter on. */}
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() => startTransition(() => router.push('/emplois', { scroll: false }))}
                className="link-ghost"
              >
                Réinitialiser
              </button>
            )}
            <span className="spacer" aria-hidden />
            <span className="t-caption-soft tabular-nums" aria-live="polite">
              {pending ? 'Recherche…' : `${data.total.toLocaleString('fr-FR')} offres`}
            </span>
          </div>
        </div>
      </header>

      {jobs.length === 0 ? (
        // Résultat vide (§4.13) : pleine largeur (pas de split, pas de détail),
        // caption verte + titre serif + termes cherchés + reset.
        <EmptyState
          query={filters.q ?? null}
          hasFilters={activeCount > 0}
          onReset={() => startTransition(() => router.push('/emplois', { scroll: false }))}
        />
      ) : (
      /* ============ Split-view : liste 480 | filet pointillé | détail (§5.2) ============
          La page scrolle (pas d'app à hauteur fixe) : la liste est une colonne
          en flux normal ; le détail est `sticky` sous le header avec un scroll
          interne (cf. .detail dans globals.css). Sous lg, une seule colonne :
          sélectionner une carte route vers /offre/[id] (voir JobCard). */
      <div className="container-wide split">
        <section aria-label="Résultats">
          <div className="list-head">
            <span className="t-caption">
              {filters.q ? `Offres · ${filters.q}` : 'Toutes les offres'}
              <span className="t-caption-soft ml-2 tabular-nums">
                · {data.total.toLocaleString('fr-FR')}
              </span>
            </span>
          </div>
          {
            <ul className={cn('transition-opacity', pending && 'opacity-50')}>
              {jobs.map((job) => (
                <li key={job.id} className="rule">
                  <JobCard
                    job={job}
                    onSelect={() => setSelectedId(job.id)}
                    isSelected={selected?.id === job.id}
                  />
                </li>
              ))}

              {/* Infinite scroll : la sentinelle déclenche la page suivante
                  400px avant d'être atteinte. Dans le même <ul> pour ne jamais
                  se désynchroniser de la liste dont elle est la queue. */}
              {loadedPage < pageCount && (
                <li ref={sentinelRef} aria-hidden={!loadingMore} className="load-more grid place-items-center">
                  {loadingMore && (
                    <span className="t-caption-soft flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                      Chargement…
                    </span>
                  )}
                </li>
              )}

              {loadError && (
                <li className="load-more grid place-items-center gap-2 text-center">
                  <p className="t-caption-soft">{loadError}</p>
                  <button type="button" onClick={() => void loadMore()} className="link-ghost">
                    Réessayer
                  </button>
                </li>
              )}
            </ul>
          }
        </section>

        {selected && <span className="rule-v hidden lg:block" aria-hidden />}

        {selected && (
          <div
            className="detail"
            style={
              headerHeight
                ? ({
                    // La barre sticky elle-même est ancrée à var(--header-h) : le
                    // détail se pose sous elle → header global + hauteur barre.
                    top: `calc(var(--header-h) + ${headerHeight}px + 16px)`,
                    maxHeight: `calc(100vh - var(--header-h) - ${headerHeight}px - 32px)`,
                  } as React.CSSProperties)
                : undefined
            }
          >
            {/* Retour à la liste — utile seulement sous lg, où le détail occupe
                toute la colonne. À lg+ les deux volets sont visibles. */}
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label="Retour à la liste des offres"
              className="mb-4 inline-flex items-center gap-2 text-ink-muted hover:text-ink lg:hidden"
            >
              <X className="size-4" /> <span className="t-ui-small">Retour</span>
            </button>
            <JobDetail job={selected} />
          </div>
        )}
      </div>
      )}
    </main>
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
      {/* Pill DA (§4.3) : trois états — repos (filet), ouverte (bord ink),
          active (fond vert-tint, bord+texte vert, croix pour retirer). */}
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          // Une pill active se vide au clic (toggle) sans ouvrir le menu.
          if (active) onSelect(active);
          else setOpen((value) => !value);
        }}
        className={cn('pill', active && 'is-active', open && 'is-open')}
      >
        {active ? `${label} · ${display(active)}` : label}
        {active ? (
          <svg viewBox="0 0 24 24" aria-label="Retirer"><path d="M6 6l12 12M18 6 6 18" /></svg>
        ) : (
          <ChevronDown className={cn('chev', open && 'rotate-180')} />
        )}
      </button>

      {open && !active && rect && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            aria-label={label}
            style={{ top: rect.top, left: rect.left }}
            className="dd fixed max-h-80 w-64 overflow-y-auto"
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
                  className={cn(isActive && 'is-checked')}
                >
                  <span className="flex min-w-0 items-center gap-2 truncate">
                    {isActive && <Check className="size-4 shrink-0" />}
                    <span className="truncate">{display(option.value)}</span>
                  </span>
                  <span className="count tabular-nums">
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

/**
 * Exported so the company profile page (/entreprise/[slug]) can reuse the
 * exact same card rather than duplicating its markup — one visual language
 * for an offer, everywhere it is listed.
 */
const FRESH_MS = 48 * 60 * 60 * 1000; // 48 h : point vert « nouvelle offre »

export function JobCard({
  job,
  onSelect,
  isSelected,
}: {
  job: JobRow;
  onSelect: () => void;
  isSelected: boolean;
}) {
  const contract = contractLabel(job.contract);
  const isFresh = job.postedAt
    ? Date.now() - new Date(job.postedAt).getTime() < FRESH_MS
    : false;

  // Offre « visitée » : grisée après lecture, mémorisée par session (per-viewer,
  // jamais partagé). Une lecture échouée ne casse jamais l'affichage.
  const [visited, setVisited] = useState(false);
  useEffect(() => {
    try {
      const seen = sessionStorage.getItem('fa:visited');
      if (seen && new Set(JSON.parse(seen) as string[]).has(job.id)) setVisited(true);
    } catch {
      /* storage indisponible : on affiche l'offre comme non visitée */
    }
  }, [job.id]);

  const markVisited = () => {
    setVisited(true);
    try {
      const seen = sessionStorage.getItem('fa:visited');
      const set = new Set(seen ? (JSON.parse(seen) as string[]) : []);
      set.add(job.id);
      sessionStorage.setItem('fa:visited', JSON.stringify([...set]));
    } catch {
      /* storage indisponible : le grisé reste local à la session en cours */
    }
  };

  // Meta : ville · contrat · télétravail — texte, sans icône (DA §4.6).
  const remote =
    job.remote?.toLowerCase().includes('télé') || job.remote?.toLowerCase().includes('remote')
      ? 'Télétravail'
      : null;
  const meta = [job.city, contract, remote].filter(Boolean).join(' · ');

  return (
    // Une VRAIE ancre (S-01) : le href est le maillage que les crawlers
    // suivent — un <button> rendait chaque offre invisible au crawl. À lg+ le
    // clic est intercepté (master-detail, volet de droite) ; sous lg la
    // navigation par défaut mène à la fiche /offre/[slug]-[id].
    <a
      href={offerPath(job)}
      onClick={(event) => {
        markVisited();
        if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
          return; // navigation native vers la fiche autonome
        }
        event.preventDefault();
        onSelect();
      }}
      aria-current={isSelected ? 'true' : undefined}
      className={cn('offer', isSelected && 'is-selected', visited && 'is-visited')}
    >
      <div className="offer__top">
        <span className="t-caption truncate">
          {job.company}
          {job.group ? <span className="muted"> · {job.group}</span> : null}
        </span>
        {job.postedAt && <span className="t-caption-soft shrink-0">{relativeDate(job.postedAt)}</span>}
      </div>

      {/* Titre : FA Display (serif), casse normalisée à l'affichage. Point vert
          si l'offre a moins de 48 h. */}
      <p className="offer__title t-d2">
        {isFresh && <span className="dot" aria-label="Nouvelle offre" />}
        {displayTitle(job.title)}
      </p>

      {meta && <p className="t-body2 muted">{meta}</p>}
    </a>
  );
}

/**
 * Résultat vide (§4.13, réf etats.html) : pleine largeur, caption verte
 * « Résultat vide » (col 1-4), titre serif + phrase reprenant les termes
 * cherchés (col 5-10), CTA « Voir toutes les offres » + lien « Réinitialiser ».
 * Pas d'illustration.
 */
function EmptyState({
  query,
  hasFilters,
  onReset,
}: {
  query: string | null;
  hasFilters: boolean;
  onReset: () => void;
}) {
  return (
    <section className="container empty rule-b" aria-labelledby="empty-title">
      <div className="g12">
        <span className="t-caption green c4">Résultat vide</span>
        <div className="s5">
          <h2 className="t-d1" id="empty-title">Aucune offre ne correspond, pour l’instant.</h2>
          <p className="t-body soft mt-4">
            {query
              ? `« ${query} » n’a pas de résultat aujourd’hui. Les Maisons publient chaque jour — élargissez la recherche ou revenez bientôt.`
              : 'Aucune offre ne correspond à ces filtres. Élargissez la recherche pour voir plus de Maisons.'}
          </p>
          <div className="actions mt-6 flex flex-wrap items-center gap-4">
            {/* Pas d'alerte côté Fashion Atlas (le compte vit sur Catwalks) :
                on propose « Voir toutes les offres », jamais un bouton d'alerte
                qui ne mène nulle part. */}
            <button type="button" onClick={onReset} className="btn btn--green">
              Voir toutes les offres
              <svg viewBox="0 0 24 24" aria-hidden width="16" height="16" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
            {hasFilters && (
              <button type="button" onClick={onReset} className="link-ghost">
                Réinitialiser les filtres
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
