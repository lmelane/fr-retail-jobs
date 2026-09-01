'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'motion/react';
import { Building2, ExternalLink, Layers, MapPin, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { relativeDate } from '@/lib/format';
import type { JobRow, JobsResult } from '@/lib/jobs';

/**
 * Leaflet reads `window` at import time, so it can only load in the browser.
 * The skeleton keeps the 50/50 split stable while it arrives, avoiding a layout
 * shift on first paint.
 */
const JobMap = dynamic(() => import('@/components/job-map'), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-none" />,
});

const SECTOR_LABELS: Record<string, string> = {
  FASHION: 'Mode',
  LUXURY: 'Luxe',
  BEAUTY: 'Beauté',
  JEWELRY_WATCHES: 'Joaillerie & Horlogerie',
  RETAIL: 'Retail',
  SUPPLIER: 'Fournisseurs',
  MEDIA_AGENCY: 'Médias & Agences',
  RECRUITER: 'Cabinets',
};

type JobsViewProps = { data: JobsResult };

export function JobsView({ data }: JobsViewProps) {
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

  const hasFilters = Boolean(query || sector || contract || city);

  function reset() {
    setQuery('');
    setSector(null);
    setContract(null);
    setCity(null);
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Catwalks</h1>
            <p className="text-muted-foreground text-sm">
              Offres Mode · Luxe · Beauté · Horlogerie · Retail en France
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data.isDemo && <Badge variant="secondary">Données de démonstration</Badge>}
            <Badge variant="outline">
              {jobs.length} offre{jobs.length > 1 ? 's' : ''}
            </Badge>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rechercher un poste ou une Maison…"
              className="pl-9"
            />
          </div>

          {data.facets.sectors.map((facet) => (
            <Button
              key={facet.value}
              variant={sector === facet.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSector(sector === facet.value ? null : facet.value)}
            >
              {SECTOR_LABELS[facet.value] ?? facet.value}
              <span className="text-muted-foreground ml-1.5 text-xs">{facet.count}</span>
            </Button>
          ))}

          {data.facets.contracts.slice(0, 4).map((facet) => (
            <Button
              key={facet.value}
              variant={contract === facet.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setContract(contract === facet.value ? null : facet.value)}
            >
              {facet.value}
            </Button>
          ))}

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={reset}>
              <X className="size-4" />
              Réinitialiser
            </Button>
          )}
        </div>
      </header>

      {/* 50/50 on desktop; the map moves below the list on narrow screens. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
        <ScrollArea className="min-h-0 border-r">
          <ul className="divide-y">
            <AnimatePresence initial={false}>
              {jobs.map((job) => (
                <motion.li
                  key={job.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                >
                  <JobItem job={job} onSelectCity={setCity} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>

          {jobs.length === 0 && (
            <div className="text-muted-foreground grid place-items-center p-16 text-sm">
              Aucune offre ne correspond à ces filtres.
            </div>
          )}
        </ScrollArea>

        <div className="relative min-h-64">
          <JobMap jobs={jobs} selectedCity={city} onSelectCity={setCity} />
          {city && (
            <div className="absolute top-3 left-3 z-[1000]">
              <Button size="sm" variant="default" onClick={() => setCity(null)}>
                <MapPin className="size-4" />
                {city}
                <X className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JobItem({ job, onSelectCity }: { job: JobRow; onSelectCity: (city: string) => void }) {
  return (
    <article className="hover:bg-accent/50 group px-5 py-4 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline-offset-4 hover:underline"
          >
            {job.title}
            <ExternalLink className="text-muted-foreground ml-1.5 inline size-3.5 align-baseline opacity-0 transition-opacity group-hover:opacity-100" />
          </a>

          <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="size-3.5" />
              {job.company}
              {job.group && <span className="text-xs">· {job.group}</span>}
            </span>

            {job.city && (
              <button
                type="button"
                onClick={() => onSelectCity(job.city!)}
                className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
              >
                <MapPin className="size-3.5" />
                {job.city}
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {job.contract && <Badge variant="secondary">{job.contract}</Badge>}
          <span className="text-muted-foreground text-xs">{relativeDate(job.postedAt)}</span>
        </div>
      </div>

      {/* Source count is the product's differentiator: one canonical job, N sources. */}
      {job.sourceCount > 1 && (
        <div className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
          <Layers className="size-3.5" />
          {job.sourceCount} sources · lien employeur retenu
        </div>
      )}
    </article>
  );
}

export { Separator };
