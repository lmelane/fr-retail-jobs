'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Briefcase, Building2, ChevronLeft, ChevronRight, MapPin, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CompanyLogo } from '@/components/company-logo';
import { cn } from '@/lib/utils';
import type { CompaniesResult, CompanyRow } from '@/lib/companies';
import type { JobRow } from '@/lib/jobs';

/**
 * Employers, ranked by open positions.
 *
 * Answers "who is hiring" rather than "what can I apply to". Clicking a Maison
 * hands off to the offer list already filtered to it, so the two pages are one
 * flow rather than two destinations.
 */

const JobMap = dynamic(() => import('@/components/job-map'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-[28px]" />,
});

const WorldMap = dynamic(() => import('@/components/world-map'), {
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
  OTHER: 'Hors référentiel',
  UNKNOWN: 'Hors référentiel',
};

/**
 * The map speaks JobRow, so each company-city pair becomes one synthetic point.
 *
 * Reusing the existing map rather than writing a second one keeps a single
 * clustering, colour and interaction behaviour across both pages.
 */
function toMapPoints(companies: CompanyRow[]): JobRow[] {
  return companies.flatMap((company) =>
    company.cities
      .filter((city) => city.latitude !== null && city.longitude !== null)
      .map((city) => ({
        id: `${company.id}:${city.city}`,
        title: `${city.count} offre${city.count > 1 ? 's' : ''}`,
        company: company.name,
        group: null,
        city: city.city,
        location: city.city,
        contract: null,
        sector: company.sector,
        url: `/?maison=${encodeURIComponent(company.name)}`,
        postedAt: null,
        latitude: city.latitude,
        longitude: city.longitude,
        sourceCount: 1,
        sources: [],
        description: null,
        applyUrl: `/?maison=${encodeURIComponent(company.name)}`,
        postalCode: null,
        department: null,
        workingTime: null,
        remote: null,
        experienceYears: null,
        educationLevel: null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryPeriod: null,
        validThrough: null,
      })),
  );
}

export function CompaniesView({ data }: { data: CompaniesResult }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(params.get('q') ?? '');

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
    <div className="bg-background flex h-dvh flex-col gap-3 overflow-hidden p-3">
      <header className="bg-surface-low shadow-m3-1 flex shrink-0 flex-col gap-3 rounded-[28px] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <nav className="bg-surface flex shrink-0 items-center gap-1 rounded-full p-1">
            <Link
              href="/"
              className="hover:bg-surface-high rounded-full px-4 py-1.5 text-sm font-medium transition-colors"
            >
              Offres
            </Link>
            <span className="bg-secondary-container text-on-secondary-container rounded-full px-4 py-1.5 text-sm font-medium">
              Entreprises
            </span>
          </nav>

          <form
            className="relative min-w-0 flex-1 sm:max-w-sm"
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ q: draft.trim() || null });
            }}
          >
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2" />
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Rechercher une Maison…"
              aria-label="Rechercher une entreprise"
              className="bg-surface h-12 rounded-full border-0 pl-12 text-sm tracking-[0.25px] shadow-none focus-visible:ring-2"
            />
          </form>

          <span className="text-muted-foreground ml-auto shrink-0 text-xs font-medium tracking-[0.5px] tabular-nums">
            {pending ? 'Recherche…' : `${data.total.toLocaleString('fr-FR')} entreprises`}
          </span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {data.sectors.map((facet) => (
            <button
              key={facet.value}
              type="button"
              onClick={() =>
                navigate({ secteur: activeSector === facet.value ? null : facet.value })
              }
              aria-pressed={activeSector === facet.value}
              className={cn(
                'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors',
                activeSector === facet.value
                  ? 'bg-secondary-container text-on-secondary-container'
                  : 'bg-surface hover:bg-surface-high',
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

      <div className="bg-surface-low shadow-m3-1 min-h-0 flex-1 overflow-hidden rounded-[28px]">
        <Tabs defaultValue="list" className="flex h-full flex-col gap-0">
          <TabsList className="bg-surface m-3 h-10 w-fit shrink-0 rounded-full p-1">
            <TabsTrigger value="list" className="rounded-full px-4 text-sm">
              Liste
            </TabsTrigger>
            <TabsTrigger value="map" className="rounded-full px-4 text-sm">
              Carte France
            </TabsTrigger>
            <TabsTrigger value="world" className="rounded-full px-4 text-sm">
              Monde
            </TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="flex min-h-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1">
              <ul
                className={cn(
                  'grid gap-2 p-3 transition-opacity sm:grid-cols-2 xl:grid-cols-3',
                  pending && 'opacity-50',
                )}
              >
                {data.companies.map((company) => (
                  <li key={company.id}>
                    <Link
                      href={`/?maison=${encodeURIComponent(company.name)}`}
                      className="bg-surface hover:bg-surface-high block h-full rounded-[20px] px-4 py-3.5 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <CompanyLogo name={company.name} size={40} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="text-foreground truncate text-[15px] leading-6 font-medium">
                              {company.name}
                            </h3>
                            <span className="bg-secondary-container text-on-secondary-container shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums">
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
              </ul>

              {data.companies.length === 0 && (
                <div className="text-muted-foreground grid place-items-center px-6 py-16 text-center text-sm">
                  Aucune entreprise ne correspond.
                </div>
              )}
            </ScrollArea>

            {data.pageCount > 1 && (
              <nav
                aria-label="Pagination"
                className="flex shrink-0 items-center justify-center gap-1 border-t border-black/5 p-3"
              >
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={data.page <= 1}
                  onClick={() => navigate({ page: String(data.page - 1) })}
                  aria-label="Page précédente"
                  className="hover:bg-surface size-9 rounded-full"
                >
                  <ChevronLeft className="size-[18px]" />
                </Button>
                <span className="text-muted-foreground px-3 text-sm tabular-nums">
                  {data.page} / {data.pageCount}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={data.page >= data.pageCount}
                  onClick={() => navigate({ page: String(data.page + 1) })}
                  aria-label="Page suivante"
                  className="hover:bg-surface size-9 rounded-full"
                >
                  <ChevronRight className="size-[18px]" />
                </Button>
              </nav>
            )}
          </TabsContent>

          <TabsContent value="map" className="min-h-0 flex-1">
            {/* One point per company-city pair, so a Maison present in twelve
                towns reads as twelve markers rather than one. */}
            <JobMap jobs={toMapPoints(data.companies)} />
          </TabsContent>

          <TabsContent value="world" className="min-h-0 flex-1">
            {/* Employer footprint across the world: one bubble per country,
                sized by how many offers sit there. */}
            <WorldMap countries={data.countries} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
