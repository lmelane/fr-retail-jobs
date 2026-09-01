'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'motion/react';
import { ArrowUpRight, Building2, Layers, MapPin, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { relativeDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { JobRow, JobsResult } from '@/lib/jobs';

/**
 * Material 3 Expressive — see DESIGN.md.
 * Hierarchy comes from stacked tinted surfaces, shapes are generous, and motion
 * is spring-based so it feels like it has mass.
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
};

/** Material spatial spring: a light overshoot, so movement reads as physical. */
const SPRING_SPATIAL = { type: 'spring' as const, stiffness: 380, damping: 30 };
/** Effects spring: no overshoot for opacity and colour. */
const SPRING_EFFECT = { type: 'spring' as const, stiffness: 400, damping: 40 };

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
    <div className="bg-background flex h-dvh flex-col gap-3 overflow-hidden p-3">
      {/* Level 2 surface: the toolbar sits above the page plane. */}
      <header className="bg-surface-low shadow-m3-1 shrink-0 rounded-[28px] px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            {/* headline-small */}
            <h1 className="text-2xl leading-8 font-normal">Catwalks</h1>
            <p className="text-muted-foreground hidden text-sm tracking-[0.25px] sm:block">
              Mode · Luxe · Beauté · Joaillerie · Retail — France
            </p>
          </div>

          <div className="flex items-center gap-2">
            {data.isDemo && (
              <Badge className="bg-accent text-accent-foreground rounded-full border-0 px-3 py-1 text-xs font-medium">
                Démo
              </Badge>
            )}
            <span className="text-muted-foreground text-xs font-medium tracking-[0.5px] tabular-nums">
              {jobs.length.toLocaleString('fr-FR')} offre{jobs.length > 1 ? 's' : ''}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2" />
            {/* corner-extra-large: a pill search field is core Material shape. */}
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Poste ou Maison…"
              className="bg-surface h-12 rounded-full border-0 pl-11 text-sm tracking-[0.25px] shadow-none"
            />
          </div>

          {data.facets.sectors.map((facet) => (
            <FilterChip
              key={facet.value}
              active={sector === facet.value}
              onClick={() => setSector(sector === facet.value ? null : facet.value)}
              count={facet.count}
            >
              {SECTOR_LABELS[facet.value] ?? facet.value}
            </FilterChip>
          ))}

          {data.facets.contracts.slice(0, 3).map((facet) => (
            <FilterChip
              key={facet.value}
              active={contract === facet.value}
              onClick={() => setContract(contract === facet.value ? null : facet.value)}
            >
              {facet.value}
            </FilterChip>
          ))}

          {activeFilters > 0 && (
            <Button
              variant="ghost"
              onClick={reset}
              className="text-muted-foreground hover:bg-surface ml-auto h-10 rounded-full px-4 text-sm font-medium tracking-[0.1px]"
            >
              <X className="size-4" />
              Effacer
            </Button>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="bg-surface-low shadow-m3-1 min-h-0 overflow-hidden rounded-[28px]">
          <ScrollArea className="h-full">
            {jobs.length === 0 ? (
              <EmptyState hasFilters={activeFilters > 0} onReset={reset} />
            ) : (
              <ul className="p-2">
                {jobs.map((job, index) => (
                  <motion.li
                    key={job.id}
                    layout="position"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...SPRING_SPATIAL, delay: Math.min(index, 14) * 0.02 }}
                  >
                    <JobCard job={job} onSelectCity={setCity} isCityActive={city === job.city} />
                  </motion.li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>

        <div className="bg-surface-low shadow-m3-1 relative min-h-72 overflow-hidden rounded-[28px] lg:min-h-0">
          <JobMap jobs={jobs} selectedCity={city} onSelectCity={setCity} />
          {city && (
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={SPRING_EFFECT}
              className="absolute top-4 left-4 z-[1000]"
            >
              <Button
                onClick={() => setCity(null)}
                className="shadow-m3-2 h-10 rounded-full px-4 text-sm font-medium tracking-[0.1px]"
              >
                <MapPin className="size-4" />
                {city}
                <X className="size-4 opacity-70" />
              </Button>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Material filter chip: fully rounded, tinted when selected. shadcn's Button
 * cannot express the chip's selected-container state without being overridden
 * into something else entirely, so the primitive stays untouched.
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
        'focus-visible:ring-ring inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium tracking-[0.1px] transition-colors focus-visible:ring-2 focus-visible:outline-none',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-surface hover:text-foreground bg-transparent',
      )}
    >
      {children}
      {count !== undefined && <span className="tabular-nums opacity-60">{count}</span>}
    </button>
  );
}

function JobCard({
  job,
  onSelectCity,
  isCityActive,
}: {
  job: JobRow;
  onSelectCity: (city: string) => void;
  isCityActive: boolean;
}) {
  return (
    <article className="hover:bg-surface group rounded-2xl px-4 py-4 transition-colors">
      <a
        href={job.url}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-lg focus-visible:ring-2 focus-visible:outline-none"
      >
        {/* title-medium */}
        <span className="text-base leading-6 font-medium tracking-[0.15px]">{job.title}</span>
        <ArrowUpRight className="text-muted-foreground size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </a>

      {/* title-small */}
      <div className="mt-1 flex items-center gap-1.5 text-sm leading-5 font-medium tracking-[0.1px]">
        <Building2 className="text-muted-foreground size-4 shrink-0" />
        <span className="truncate">{job.company}</span>
        {job.group && (
          <span className="text-muted-foreground shrink-0 font-normal">· {job.group}</span>
        )}
      </div>

      {/* label-medium */}
      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs font-medium tracking-[0.5px]">
        {job.city && (
          <button
            type="button"
            onClick={() => onSelectCity(job.city!)}
            className={cn(
              'focus-visible:ring-ring inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors focus-visible:ring-2 focus-visible:outline-none',
              isCityActive
                ? 'bg-accent text-accent-foreground'
                : 'bg-surface hover:bg-surface-high',
            )}
          >
            <MapPin className="size-3" />
            {job.city}
          </button>
        )}

        {job.contract && <span className="bg-surface rounded-full px-2 py-1">{job.contract}</span>}

        {job.postedAt && <span className="tabular-nums">{relativeDate(job.postedAt)}</span>}

        {/* The product's differentiator: one canonical job, N sources. */}
        {job.sourceCount > 1 && (
          <span className="inline-flex items-center gap-1">
            <Layers className="size-3" />
            <span className="tabular-nums">{job.sourceCount}</span> sources
          </span>
        )}
      </div>
    </article>
  );
}

function EmptyState({ hasFilters, onReset }: { hasFilters: boolean; onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <div className="bg-accent flex size-14 items-center justify-center rounded-full">
        <Search className="text-accent-foreground size-6" />
      </div>
      <div className="space-y-1">
        <p className="text-base leading-6 font-medium tracking-[0.15px]">Aucune offre trouvée</p>
        <p className="text-muted-foreground max-w-sm text-sm leading-5 tracking-[0.25px]">
          {hasFilters
            ? 'Aucune offre ne correspond à cette combinaison de filtres.'
            : 'Les offres apparaîtront ici dès la prochaine synchronisation des sources.'}
        </p>
      </div>
      {hasFilters && (
        <Button
          onClick={onReset}
          className="h-10 rounded-full px-6 text-sm font-medium tracking-[0.1px]"
        >
          Effacer les filtres
        </Button>
      )}
    </div>
  );
}
