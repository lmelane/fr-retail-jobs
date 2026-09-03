'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Building2, Loader2, MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CompanyLogo } from '@/components/company-logo';
import { AutocompleteField } from '@/components/search-pill';
import { cn } from '@/lib/utils';
import { companySlug } from '@/lib/company-slug';
import type { CompaniesResult, CompanyFilters, CompanyRow } from '@/lib/companies';

/**
 * Employers, ranked by open positions — Indeed's company directory shape
 * (big title, search pill, a GRID of cards), not a list-plus-map.
 *
 * Answers "who is hiring" rather than "what can I apply to". Clicking a Maison
 * hands off to the offer list already filtered to it, so the two pages are one
 * flow rather than two destinations.
 *
 * No map: decision D12 drops maps everywhere on the site. A grid of cards
 * fills the width Indeed's directory does, instead of a narrow list sitting
 * beside empty space.
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
  OTHER: 'Hors référentiel',
  UNKNOWN: 'Hors référentiel',
};

export function CompaniesView({ data }: { data: CompaniesResult; filters: CompanyFilters }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(params.get('q') ?? '');

  /**
   * Infinite scroll, the same shape as the offer list: page 1 arrives
   * server-rendered in `data`; scrolling near the bottom fetches page 2+ from
   * /api/companies and appends it. Both lists on the site scroll, rather than
   * one paging with buttons and the other by scrolling.
   */
  const [companies, setCompanies] = useState<CompanyRow[]>(data.companies);
  const [loadedPage, setLoadedPage] = useState(data.page);
  const [pageCount, setPageCount] = useState(data.pageCount);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);

  // A new server render — a new search or sector — replaces the accumulated
  // list rather than appending to it.
  useEffect(() => {
    setCompanies(data.companies);
    setLoadedPage(data.page);
    setPageCount(data.pageCount);
    setLoadError(null);
  }, [data.companies, data.page, data.pageCount]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loadedPage >= pageCount) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const next = new URLSearchParams(params.toString());
      next.set('page', String(loadedPage + 1));
      const response = await fetch(`/api/companies?${next.toString()}`);
      if (!response.ok) throw new Error(`Le serveur a répondu ${response.status}.`);
      const result = (await response.json()) as CompaniesResult;
      setCompanies((current) => [...current, ...result.companies]);
      setLoadedPage(result.page);
      setPageCount(result.pageCount);
    } catch {
      setLoadError('Le chargement des entreprises suivantes a échoué.');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loadedPage, pageCount, params]);

  // The sentinel sits after the last card; entering the viewport (or within
  // 400px of it) loads the next page — no click, same as the offer list.
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

  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in changes)) next.delete('page');
    startTransition(() =>
      router.push(next.toString() ? `/entreprises?${next}` : '/entreprises', { scroll: false }),
    );
  };

  const activeSector = params.get('secteur');

  return (
    <div className="bg-background flex h-dvh flex-col overflow-hidden">
      <header className="border-border/70 shrink-0 border-b bg-white">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">

          <form
            className="border-border relative mx-auto flex h-11 w-full max-w-sm items-center rounded-full border bg-white focus-within:ring-2 focus-within:ring-black/20"
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ q: draft.trim() || null });
            }}
          >
            <AutocompleteField
              type="company"
              value={draft}
              onChange={setDraft}
              onCommit={(value) => {
                setDraft(value);
                navigate({ q: value.trim() || null });
              }}
              icon={<Search className="text-muted-foreground size-[18px] shrink-0" aria-hidden />}
              placeholder="Rechercher une Maison…"
              ariaLabel="Rechercher une entreprise"
            />
          </form>

          <span className="text-muted-foreground ml-auto shrink-0 text-xs font-normal tracking-[0.4px] tabular-nums">
            {pending ? 'Recherche…' : `${data.total.toLocaleString('fr-FR')} entreprises`}
          </span>
        </div>

        <div className="mx-auto flex max-w-[1280px] items-center gap-2 overflow-x-auto px-6 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {data.sectors.map((facet) => (
            <button
              key={facet.value}
              type="button"
              onClick={() =>
                navigate({ secteur: activeSector === facet.value ? null : facet.value })
              }
              aria-pressed={activeSector === facet.value}
              className={cn(
                'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[13px] font-normal tracking-[0.4px] transition-colors duration-300 ease-catwalks',
                activeSector === facet.value
                  ? 'border-foreground bg-secondary-container text-on-secondary-container'
                  : 'border-border bg-white hover:bg-surface',
              )}
            >
              {SECTOR_LABELS[facet.value] ?? facet.value}
              <span className="text-muted-foreground text-xs tabular-nums">
                {facet.count.toLocaleString('fr-FR')}
              </span>
            </button>
          ))}
        </div>
      </header>

      {/* A responsive grid filling the width, Indeed's directory shape —
          no permanent map beside a narrow list. */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[1280px] p-4">
          {companies.length === 0 ? (
            <div className="text-muted-foreground grid place-items-center px-6 py-16 text-center text-sm">
              Aucune entreprise ne correspond.
            </div>
          ) : (
            <ul
              className={cn(
                'grid grid-cols-1 gap-3 transition-opacity md:grid-cols-2 lg:grid-cols-3',
                pending && 'opacity-50',
              )}
            >
              {companies.map((company) => (
                <li key={company.id}>
                  <CompanyCard company={company} />
                </li>
              ))}

              {/* Infinite scroll: this sentinel triggers the next page as it
                  nears the viewport, mirroring the offer list. Spans every
                  column so it doesn't distort the grid. */}
              {loadedPage < pageCount && (
                <li
                  ref={sentinelRef}
                  aria-hidden={!loadingMore}
                  className="col-span-full grid place-items-center py-4"
                >
                  {loadingMore && (
                    <Loader2 className="text-muted-foreground size-5 animate-spin" aria-label="Chargement…" />
                  )}
                </li>
              )}

              {loadError && (
                <li className="col-span-full flex flex-col items-center gap-2 py-4">
                  <p className="text-muted-foreground text-sm">{loadError}</p>
                  <Button variant="ghost" size="sm" onClick={() => void loadMore()} className="rounded-full">
                    Réessayer
                  </Button>
                </li>
              )}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * One employer, Indeed's directory card minus reviews (we have none): logo,
 * name, sector, open-position count. Thin border, small radius, tight
 * padding — the same dense visual language as the offer list's JobCard,
 * not the old heavy rounded-[20px] card.
 */
function CompanyCard({ company }: { company: CompanyRow }) {
  return (
    <Link
      href={`/entreprise/${companySlug(company.name)}`}
      className="border-border block h-full rounded-[16px] border bg-white px-5 py-4 shadow-none transition-shadow duration-300 ease-catwalks hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]"
    >
      <div className="flex items-start gap-3">
        <CompanyLogo name={company.name} size={40} />
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground truncate text-[16px] leading-6 font-normal tracking-[0.4px] uppercase">
            {company.name}
          </h3>
          <p className="text-grey-400 mt-0.5 flex items-center gap-1.5 text-[13px] tracking-[0.4px]">
            <Building2 className="size-3.5 shrink-0 opacity-70" />
            {SECTOR_LABELS[company.sector ?? ''] ?? 'Hors référentiel'}
          </p>
        </div>
      </div>

      <p className="text-foreground mt-2.5 text-[13px] font-normal tracking-[0.4px] tabular-nums">
        {company.jobCount.toLocaleString('fr-FR')}{' '}
        {company.jobCount > 1 ? 'emplois ouverts' : 'emploi ouvert'}
      </p>

      {company.cities.length > 0 && (
        <p className="text-grey-400 mt-1.5 flex items-start gap-1.5 text-[12px] tracking-[0.4px]">
          <MapPin className="mt-0.5 size-3.5 shrink-0 opacity-70" />
          <span className="line-clamp-2">
            {company.cities
              .slice(0, 4)
              .map((city) => `${city.city} (${city.count})`)
              .join(' · ')}
            {company.cities.length > 4 && ` +${company.cities.length - 4}`}
          </span>
        </p>
      )}
    </Link>
  );
}
