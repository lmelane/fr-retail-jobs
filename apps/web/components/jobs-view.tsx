'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'motion/react';
import { ArrowUpRight, Building2, Layers, MapPin, Search, SlidersHorizontal, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { relativeDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { JobRow, JobsResult } from '@/lib/jobs';

/** See DESIGN.md — dense precision tool, three type levels, accent as signal. */

const JobMap = dynamic(() => import('@/components/job-map'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
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
};

/** Entrance cascade, capped so a long list never staggers past ~200ms. */
const STAGGER_MS = 12;
const MAX_STAGGER_INDEX = 16;

export function JobsView({ data }: { data: JobsResult }) {
  const [query, setQuery] = useState('');
  const [sector, setSector] = useState<string | null>(null);
  const [contract, setContract] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);

  const jobs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.jobs.filter((job) => {
      if (sector && job.sector !== sector) return false;
      if (contract && job.contract !== contract) return false;
      if (city && job.city !== city) return false;
      if (needle && !`${job.title} ${job.company}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data.jobs, query, sector, contract, city]);

  const activeFilters = [sector, contract, city].filter(Boolean).length + (query ? 1 : 0);

  function reset() {
    setQuery('');
    setSector(null);
    setContract(null);
    setCity(null);
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Header
        total={jobs.length}
        isDemo={data.isDemo}
        query={query}
        onQuery={setQuery}
        facets={data.facets}
        sector={sector}
        contract={contract}
        onSector={setSector}
        onContract={setContract}
        activeFilters={activeFilters}
        onReset={reset}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <ScrollArea className="min-h-0 border-r">
          {jobs.length === 0 ? (
            <EmptyState hasFilters={activeFilters > 0} onReset={reset} />
          ) : (
            <ul>
              {jobs.map((job, index) => (
                <motion.li
                  key={job.id}
                  layout="position"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.18,
                    delay: (Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS) / 1000,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="border-b last:border-b-0"
                >
                  <JobRowItem job={job} onSelectCity={setCity} isCityActive={city === job.city} />
                </motion.li>
              ))}
            </ul>
          )}
        </ScrollArea>

        <div className="relative min-h-72 lg:min-h-0">
          <JobMap jobs={jobs} selectedCity={city} onSelectCity={setCity} />
          {city && (
            <div className="absolute top-3 left-3 z-[1000]">
              <Button
                size="sm"
                onClick={() => setCity(null)}
                className="h-8 shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
              >
                <MapPin className="size-3.5" />
                <span className="tabular-nums">{city}</span>
                <X className="size-3.5 opacity-70" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type HeaderProps = {
  total: number;
  isDemo: boolean;
  query: string;
  onQuery: (value: string) => void;
  facets: JobsResult['facets'];
  sector: string | null;
  contract: string | null;
  onSector: (value: string | null) => void;
  onContract: (value: string | null) => void;
  activeFilters: number;
  onReset: () => void;
};

function Header({
  total,
  isDemo,
  query,
  onQuery,
  facets,
  sector,
  contract,
  onSector,
  onContract,
  activeFilters,
  onReset,
}: HeaderProps) {
  return (
    <header className="bg-background/80 supports-[backdrop-filter]:bg-background/65 sticky top-0 z-20 border-b backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4 px-5 pt-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[15px] font-semibold tracking-[-0.015em]">Catwalks</h1>
          <p className="text-muted-foreground hidden text-[12px] sm:block">
            Mode · Luxe · Beauté · Joaillerie · Retail — France
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isDemo && (
            <Badge variant="outline" className="h-6 text-[11px] font-normal">
              Démo
            </Badge>
          )}
          <span className="text-muted-foreground text-[12px] tabular-nums">
            {total.toLocaleString('fr-FR')} offre{total > 1 ? 's' : ''}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-5 py-3">
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Poste ou Maison…"
            className="h-8 pl-8 text-[13px]"
          />
        </div>

        <div className="bg-border mx-1 hidden h-5 w-px sm:block" />

        {facets.sectors.map((facet) => (
          <FilterChip
            key={facet.value}
            active={sector === facet.value}
            onClick={() => onSector(sector === facet.value ? null : facet.value)}
            count={facet.count}
          >
            {SECTOR_LABELS[facet.value] ?? facet.value}
          </FilterChip>
        ))}

        {facets.contracts.slice(0, 3).map((facet) => (
          <FilterChip
            key={facet.value}
            active={contract === facet.value}
            onClick={() => onContract(contract === facet.value ? null : facet.value)}
          >
            {facet.value}
          </FilterChip>
        ))}

        {activeFilters > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <SlidersHorizontal className="size-3" />
            {activeFilters} filtre{activeFilters > 1 ? 's' : ''}
            <X className="size-3" />
          </button>
        )}
      </div>
    </header>
  );
}

/**
 * Filter chip rather than a shadcn Button: at 28px with a count, the Button's
 * padding scale makes the row nearly twice as tall as the design allows.
 */
function FilterChip({
  children,
  active,
  onClick,
  count,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'focus-visible:ring-ring inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none',
        active
          ? 'border-transparent bg-[var(--color-accent-solid)] text-white'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted border-transparent',
      )}
    >
      {children}
      {count !== undefined && (
        <span className={cn('tabular-nums', active ? 'text-white/70' : 'text-muted-foreground/60')}>
          {count}
        </span>
      )}
    </button>
  );
}

function JobRowItem({
  job,
  onSelectCity,
  isCityActive,
}: {
  job: JobRow;
  onSelectCity: (city: string) => void;
  isCityActive: boolean;
}) {
  return (
    <article className="hover:bg-muted/50 group relative px-5 py-3 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm text-[15px] font-medium tracking-[-0.011em] focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="truncate">{job.title}</span>
            <ArrowUpRight className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </a>

          <div className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium">
            <Building2 className="text-muted-foreground size-3.5 shrink-0" />
            <span className="text-foreground/80 truncate">{job.company}</span>
            {job.group && (
              <span className="text-muted-foreground shrink-0 text-[12px] font-normal">
                {job.group}
              </span>
            )}
          </div>

          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px]">
            {job.city && (
              <button
                type="button"
                onClick={() => onSelectCity(job.city!)}
                className={cn(
                  'focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                  isCityActive ? 'text-[var(--color-accent-solid)]' : 'hover:text-foreground',
                )}
              >
                <MapPin className="size-3" />
                {job.city}
              </button>
            )}

            {job.contract && (
              <>
                <span aria-hidden className="opacity-40">
                  ·
                </span>
                <span>{job.contract}</span>
              </>
            )}

            {job.postedAt && (
              <>
                <span aria-hidden className="opacity-40">
                  ·
                </span>
                <span className="tabular-nums">{relativeDate(job.postedAt)}</span>
              </>
            )}

            {/* The product's differentiator: one canonical job, N sources. */}
            {job.sourceCount > 1 && (
              <>
                <span aria-hidden className="opacity-40">
                  ·
                </span>
                <span className="inline-flex items-center gap-1">
                  <Layers className="size-3" />
                  <span className="tabular-nums">{job.sourceCount}</span> sources
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function EmptyState({ hasFilters, onReset }: { hasFilters: boolean; onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <div className="bg-muted flex size-10 items-center justify-center rounded-full">
        <Search className="text-muted-foreground size-4" />
      </div>
      <div className="space-y-1">
        <p className="text-[14px] font-medium">Aucune offre trouvée</p>
        <p className="text-muted-foreground max-w-xs text-[12px]">
          {hasFilters
            ? 'Aucune offre ne correspond à cette combinaison de filtres.'
            : "Les offres apparaîtront ici dès la prochaine synchronisation des sources."}
        </p>
      </div>
      {hasFilters && (
        <Button variant="outline" size="sm" onClick={onReset} className="h-7 text-[12px]">
          Retirer les filtres
        </Button>
      )}
    </div>
  );
}
