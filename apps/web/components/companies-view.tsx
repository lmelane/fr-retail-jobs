'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Building2, Loader2, MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { CompanyLogo } from '@/components/company-logo';
import { cn } from '@/lib/utils';
import type { CompaniesResult, CompanyFilters, CompanyRow } from '@/lib/companies';

/**
 * Employers, ranked by open positions.
 *
 * Answers "who is hiring" rather than "what can I apply to". Clicking a Maison
 * hands off to the offer list already filtered to it, so the two pages are one
 * flow rather than two destinations.
 *
 * One map, permanently in view next to the list — no tab to choose between a
 * France map and a world map. The world map is the right single view here: a
 * company list spans every country these Maisons hire in, and a footprint
 * bubble per country answers "where" at a glance the way a France-only city
 * map cannot for employers hiring from Tokyo to New York.
 */

const WorldMap = dynamic(() => import('@/components/world-map'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-[20px]" />,
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
  OTHER: 'Hors référentiel',
  UNKNOWN: 'Hors référentiel',
};

export function CompaniesView({ data }: { data: CompaniesResult; filters: CompanyFilters }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(params.get('q') ?? '');
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

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
        <div className="mx-auto flex max-w-[1280px] items-center gap-6 px-6 py-3">
          <nav className="flex shrink-0 items-center gap-6">
            <Link href="/" className="text-primary text-xl font-bold tracking-tight">
              Catwalks
            </Link>
            <div className="hidden items-center gap-5 sm:flex">
              <Link
                href="/"
                className="text-foreground/80 hover:text-foreground pb-3 text-sm font-medium transition-colors"
              >
                Offres
              </Link>
              <span className="text-foreground border-primary -mb-[13px] border-b-2 pb-3 text-sm font-semibold">
                Entreprises
              </span>
            </div>
          </nav>

          <form
            className="border-border relative mx-auto flex h-11 w-full max-w-sm items-center rounded-full border bg-white pl-4 shadow-sm focus-within:ring-2 focus-within:ring-primary/40"
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ q: draft.trim() || null });
            }}
          >
            <Search className="text-muted-foreground size-[18px] shrink-0" aria-hidden />
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Rechercher une Maison…"
              aria-label="Rechercher une entreprise"
              className="text-foreground placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
            />
          </form>

          <span className="text-muted-foreground ml-auto shrink-0 text-xs font-medium tabular-nums">
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
                'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[13px] font-medium transition-colors',
                activeSector === facet.value
                  ? 'border-primary/30 bg-secondary-container text-on-secondary-container font-semibold'
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

      {/* List on the left, one world map on the right — permanently, no tab. */}
      <div className="mx-auto grid min-h-0 w-full max-w-[1280px] flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,470px)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <ScrollArea className="min-h-0 flex-1">
            <ul className={cn('flex flex-col gap-2.5 pr-2 pb-2 transition-opacity', pending && 'opacity-50')}>
              {companies.map((company) => (
                <li key={company.id}>
                  <Link
                    href={`/?maison=${encodeURIComponent(company.name)}`}
                    className="border-border hover:border-foreground/20 block h-full rounded-[20px] border bg-white px-4 py-3.5 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <CompanyLogo name={company.name} size={40} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="text-foreground truncate text-[15px] leading-6 font-bold">
                            {company.name}
                          </h3>
                          <span className="bg-secondary-container text-on-secondary-container shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums">
                            {company.jobCount.toLocaleString('fr-FR')}
                          </span>
                        </div>
                        <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
                          <Building2 className="size-3.5 opacity-70" />
                          {SECTOR_LABELS[company.sector ?? ''] ?? 'Hors référentiel'}
                        </p>
                      </div>
                    </div>
                    {company.cities.length > 0 && (
                      <p className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs">
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
                </li>
              ))}

              {/* Infinite scroll: this sentinel triggers the next page as it
                  nears the viewport, mirroring the offer list. */}
              {loadedPage < pageCount && (
                <li ref={sentinelRef} aria-hidden={!loadingMore} className="grid place-items-center py-4">
                  {loadingMore && (
                    <Loader2 className="text-muted-foreground size-5 animate-spin" aria-label="Chargement…" />
                  )}
                </li>
              )}

              {loadError && (
                <li className="flex flex-col items-center gap-2 py-4">
                  <p className="text-muted-foreground text-sm">{loadError}</p>
                  <Button variant="ghost" size="sm" onClick={() => void loadMore()} className="rounded-full">
                    Réessayer
                  </Button>
                </li>
              )}
            </ul>

            {companies.length === 0 && (
              <div className="text-muted-foreground grid place-items-center px-6 py-16 text-center text-sm">
                Aucune entreprise ne correspond.
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="border-border min-h-72 overflow-hidden rounded-[20px] border lg:min-h-0">
          {/* Employer footprint across the world: one bubble per country, sized
              by how many offers sit there. */}
          <WorldMap
            countries={data.countries}
            selected={selectedCountry}
            onSelect={setSelectedCountry}
          />
        </div>
      </div>
    </div>
  );
}
