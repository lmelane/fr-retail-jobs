'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Building2, ChevronLeft, ChevronRight, Layers, MapPin, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { JobDetail } from '@/components/job-detail';
import { contractLabel, relativeDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { JobFilters, JobRow, JobsResult } from '@/lib/jobs';

/**
 * A jobboard, shaped like the ones candidates already know.
 *
 * Three rules the layout follows, each of them a fix for something that was
 * wrong before:
 *
 *  - Search state lives in the URL. Filtering, paging and searching are server
 *    round-trips, so a result set can be linked and Back walks through searches.
 *  - Filters sit in the open, not behind a drawer. A filter you cannot see is a
 *    filter you forget is applied.
 *  - The list and the map are two views of the same results and share the left
 *    pane; the offer stays put on the right, so opening the map never costs the
 *    posting being read.
 *
 * There is no product name anywhere in here. The page is the offers.
 */

const JobMap = dynamic(() => import('@/components/job-map'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-[28px]" />,
});

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
  page: 'page',
};

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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A new page of results invalidates the selection: the previously selected
  // offer is no longer in the list.
  useEffect(() => setSelectedId(null), [data.jobs]);
  useEffect(() => setDraft(filters.q ?? ''), [filters.q]);

  const selected = data.jobs.find((job) => job.id === selectedId) ?? data.jobs[0] ?? null;

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
    startTransition(() => router.push(next.toString() ? `/?${next}` : '/', { scroll: false }));
  };

  /** Clicking an active value clears it, so each control is its own toggle. */
  const toggle = (key: string, value: string) =>
    navigate({ [key]: params.get(key) === value ? null : value });

  const activeCount = Object.values(PARAM).filter(
    (key) => key !== 'page' && params.get(key),
  ).length;

  return (
    <div className="bg-background flex h-dvh flex-col gap-3 overflow-hidden p-3">
      <header className="bg-surface-low shadow-m3-1 flex shrink-0 flex-col gap-3 rounded-[28px] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <nav className="bg-surface flex shrink-0 items-center gap-1 rounded-full p-1">
            <span className="bg-secondary-container text-on-secondary-container rounded-full px-4 py-1.5 text-sm font-medium">
              Offres
            </span>
            <Link
              href="/entreprises"
              className="hover:bg-surface-high rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
            >
              Entreprises
            </Link>
          </nav>

          <form
            className="relative min-w-0 flex-1 sm:max-w-md"
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ q: draft.trim() || null });
            }}
          >
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2" />
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Poste, Maison, ville, mot-clé…"
              aria-label="Rechercher une offre"
              className="bg-surface h-12 rounded-full border-0 pl-12 text-sm tracking-[0.25px] shadow-none focus-visible:ring-2"
            />
          </form>

          <div className="text-muted-foreground ml-auto flex shrink-0 items-center gap-3 text-xs font-medium tracking-[0.5px] tabular-nums">
            <span aria-live="polite">
              {pending ? 'Recherche…' : `${data.total.toLocaleString('fr-FR')} offres`}
              {data.total < data.totalInDatabase && (
                <span className="opacity-60">
                  {' '}
                  sur {data.totalInDatabase.toLocaleString('fr-FR')}
                </span>
              )}
            </span>
            {activeCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startTransition(() => router.push('/', { scroll: false }))}
                className="hover:bg-surface h-8 rounded-full px-3 text-xs"
              >
                <X className="size-4" />
                Effacer
              </Button>
            )}
          </div>
        </div>

        {/* Filters in the open. Counts come from the whole match set, not the
            current page, so a chip saying 300 means 300. */}
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

      {/* The list NEVER moves: it stays on the left in both modes, because it
          is what the candidate is working through. The right pane switches
          between the offer being read and the map — so opening the map costs
          the detail (which the map replaces on purpose), never the list. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="bg-surface-low shadow-m3-1 flex min-h-0 flex-col overflow-hidden rounded-[28px]">
          <ScrollArea className="min-h-0 flex-1">
            {data.jobs.length === 0 ? (
              <EmptyState
                hasFilters={activeCount > 0}
                onReset={() => startTransition(() => router.push('/', { scroll: false }))}
              />
            ) : (
              <ul className={cn('p-2 transition-opacity', pending && 'opacity-50')}>
                {data.jobs.map((job) => (
                  <li key={job.id}>
                    <JobCard
                      job={job}
                      onSelect={() => setSelectedId(job.id)}
                      isSelected={selected?.id === job.id}
                    />
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>

          {data.pageCount > 1 && (
            <Pagination
              page={data.page}
              pageCount={data.pageCount}
              onGo={(page) => navigate({ page: String(page) })}
            />
          )}
        </div>

        <div className="bg-surface-low shadow-m3-1 min-h-72 overflow-hidden rounded-[28px] lg:min-h-0">
          <Tabs defaultValue="detail" className="flex h-full flex-col gap-0">
            <TabsList className="bg-surface m-3 h-10 w-fit shrink-0 rounded-full p-1">
              <TabsTrigger value="detail" className="rounded-full px-4 text-sm">
                Offre
              </TabsTrigger>
              <TabsTrigger value="map" className="rounded-full px-4 text-sm">
                Carte
              </TabsTrigger>
            </TabsList>

            <TabsContent value="detail" className="min-h-0 flex-1">
              {selected ? (
                <JobDetail job={selected} />
              ) : (
                <div className="text-muted-foreground grid h-full place-items-center px-6 text-center text-sm tracking-[0.25px]">
                  Sélectionnez une offre pour lire le détail.
                </div>
              )}
            </TabsContent>

            <TabsContent value="map" className="relative min-h-0 flex-1">
              {/* The map clusters by city, so a marker filters the list by that
                  city — it does not select one offer. */}
              <JobMap
                jobs={data.jobs}
                selectedCity={params.get('ville')}
                onSelectCity={(value) => navigate({ ville: value })}
              />
              {params.get('ville') && (
                <div className="absolute top-4 left-4 z-[1000]">
                  <Button
                    onClick={() => navigate({ ville: null })}
                    className="shadow-m3-2 h-10 rounded-full px-4 text-sm font-medium"
                  >
                    <MapPin className="size-4" />
                    {params.get('ville')}
                    <X className="size-4 opacity-70" />
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

/**
 * A dropdown of facet values with their counts.
 *
 * Native <details> rather than a popover library: it closes on Escape and on
 * outside click for free, and keeps the filter row honest about how much
 * machinery a select really needs.
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
  if (options.length === 0) return null;
  const display = (value: string) => labels?.[value] ?? value;

  return (
    <details className="group relative shrink-0">
      <summary
        className={cn(
          'flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-full px-4 text-sm font-medium tracking-[0.1px] transition-colors',
          active
            ? 'bg-secondary-container text-on-secondary-container'
            : 'bg-surface text-foreground hover:bg-surface-high',
        )}
      >
        {active ? display(active) : label}
        <ChevronRight className="size-4 rotate-90 opacity-60" />
      </summary>
      <div className="bg-surface shadow-m3-2 absolute top-11 left-0 z-50 max-h-80 w-64 overflow-y-auto rounded-2xl p-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={(event) => {
              // Close the menu on pick: a <details> stays open on its own, and
              // an open panel over a refreshing list reads as "nothing
              // happened" even while the filter is applying.
              event.currentTarget.closest('details')?.removeAttribute('open');
              onSelect(option.value);
            }}
            className={cn(
              'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors',
              option.value === active
                ? 'bg-secondary-container text-on-secondary-container'
                : 'hover:bg-surface-high',
            )}
          >
            <span className="truncate">{display(option.value)}</span>
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {option.count.toLocaleString('fr-FR')}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}

function Pagination({
  page,
  pageCount,
  onGo,
}: {
  page: number;
  pageCount: number;
  onGo: (page: number) => void;
}) {
  // A window around the current page: 32,000 offers is 1,280 pages, and no one
  // needs 1,280 buttons.
  const from = Math.max(1, Math.min(page - 2, pageCount - 4));
  const pages = Array.from({ length: Math.min(5, pageCount) }, (_, index) => from + index);

  return (
    <nav
      aria-label="Pagination"
      className="flex shrink-0 items-center justify-center gap-1 border-t border-black/5 p-3"
    >
      <Button
        variant="ghost"
        size="icon"
        disabled={page <= 1}
        onClick={() => onGo(page - 1)}
        aria-label="Page précédente"
        className="hover:bg-surface size-9 rounded-full"
      >
        <ChevronLeft className="size-[18px]" />
      </Button>

      {pages.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onGo(value)}
          aria-current={value === page ? 'page' : undefined}
          className={cn(
            'size-9 rounded-full text-sm font-medium tabular-nums transition-colors',
            value === page
              ? 'bg-secondary-container text-on-secondary-container'
              : 'hover:bg-surface',
          )}
        >
          {value}
        </button>
      ))}

      <Button
        variant="ghost"
        size="icon"
        disabled={page >= pageCount}
        onClick={() => onGo(page + 1)}
        aria-label="Page suivante"
        className="hover:bg-surface size-9 rounded-full"
      >
        <ChevronRight className="size-[18px]" />
      </Button>
    </nav>
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
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isSelected ? 'true' : undefined}
      className={cn(
        'w-full rounded-[20px] px-4 py-3 text-left transition-colors',
        isSelected ? 'bg-secondary-container' : 'hover:bg-surface',
      )}
    >
      <h3 className="text-foreground truncate text-[15px] leading-6 font-medium tracking-[0.15px]">
        {job.title}
      </h3>
      <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 truncate text-sm">
        <Building2 className="size-[15px] shrink-0 opacity-70" />
        {job.company}
      </p>
      <p className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tracking-[0.4px]">
        {job.city && (
          <span className="flex items-center gap-1">
            <MapPin className="size-[13px] opacity-70" />
            {job.city}
          </span>
        )}
        {contractLabel(job.contract) && <span>{contractLabel(job.contract)}</span>}
        {job.postedAt && <span>{relativeDate(job.postedAt)}</span>}
        {job.sourceCount > 1 && (
          <span className="flex items-center gap-1">
            <Layers className="size-[13px] opacity-70" />
            {job.sourceCount} sources
          </span>
        )}
      </p>
    </button>
  );
}

function EmptyState({ hasFilters, onReset }: { hasFilters: boolean; onReset: () => void }) {
  return (
    <div className="grid h-full place-items-center px-6 py-16 text-center">
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
