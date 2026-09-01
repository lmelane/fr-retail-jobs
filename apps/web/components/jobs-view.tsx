'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'motion/react';
import {
  Building2,
  Check,
  Clock,
  Layers,
  MapPin,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { JobDetail } from '@/components/job-detail';
import { relativeDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { JobRow, JobsResult } from '@/lib/jobs';

/**
 * Material 3 Expressive — see DESIGN.md.
 *
 * The filters expose the aggregator's real model, not a subset of it: sector,
 * Maison and group come from the 713-house reference list, contract from the
 * normalized vocabulary, city from collapsed locations, and source / multi-source
 * from the dedup layer. "Confirmées" in particular is the product's own
 * differentiator surfaced as a control — a job several sources agree on.
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
  // Employers the 728-house reference list does not name — enseignes reached
  // through a jobboard rather than their own ATS. "UNKNOWN" read as a bug; the
  // offers are real, they simply sit outside the reference list.
  OTHER: 'Hors référentiel',
  UNKNOWN: 'Hors référentiel',
};

const SOURCE_LABELS: Record<string, string> = {
  richemont: 'Richemont',
  kering: 'Kering',
  loreal: "L'Oréal",
  courir: 'Courir',
  lacoste: 'Lacoste',
  sephora: 'Sephora',
  puig: 'Puig',
  'galeries-lafayette': 'Galeries Lafayette',
  lvmh: 'LVMH',
  wttj: 'Welcome to the Jungle',
  fashionjobs: 'FashionJobs',
};

const RECENCY_OPTIONS = [
  { value: 3, label: '3 jours' },
  { value: 7, label: '7 jours' },
  { value: 30, label: '30 jours' },
];

/** Material springs: spatial overshoots slightly, effects do not. */
const SPRING_SPATIAL = { type: 'spring' as const, stiffness: 380, damping: 30 };
const SPRING_EFFECT = { type: 'spring' as const, stiffness: 400, damping: 40 };

type Filters = {
  sector: string | null;
  contract: string | null;
  city: string | null;
  group: string | null;
  maison: string | null;
  source: string | null;
  multiSource: boolean;
  maxAgeDays: number | null;
};

const EMPTY_FILTERS: Filters = {
  sector: null,
  contract: null,
  city: null,
  group: null,
  maison: null,
  source: null,
  multiSource: false,
  maxAgeDays: null,
};

export function JobsView({ data }: { data: JobsResult }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  /** Clicking an active value clears it, so every chip is its own toggle. */
  const toggle = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((current) => ({ ...current, [key]: current[key] === value ? null : value }));

  const jobs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const cutoff = filters.maxAgeDays ? Date.now() - filters.maxAgeDays * 86_400_000 : null;

    return data.jobs.filter((job) => {
      if (filters.sector && job.sector !== filters.sector) return false;
      if (filters.contract && job.contract !== filters.contract) return false;
      if (filters.city && job.city !== filters.city) return false;
      if (filters.group && job.group !== filters.group) return false;
      if (filters.maison && job.company !== filters.maison) return false;
      if (filters.source && !job.sources.includes(filters.source)) return false;
      if (filters.multiSource && job.sourceCount < 2) return false;
      if (cutoff && (!job.postedAt || new Date(job.postedAt).getTime() < cutoff)) return false;
      if (needle && !`${job.title} ${job.company}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data.jobs, query, filters]);

  const selected = jobs.find((job) => job.id === selectedId) ?? jobs[0] ?? null;

  const activeCount =
    Object.values(filters).filter((value) => value !== null && value !== false).length +
    (query ? 1 : 0);

  const reset = () => {
    setFilters(EMPTY_FILTERS);
    setQuery('');
  };

  return (
    <div className="bg-background flex h-dvh flex-col gap-3 overflow-hidden p-3">
      {/* One compact command bar. No marketing title inside a product surface:
          the tab already says Catwalks, and the row buys back vertical space
          for offers, which is what the page is for. */}
      <header className="bg-surface-low shadow-m3-1 flex shrink-0 flex-wrap items-center gap-2 rounded-[28px] px-4 py-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un poste, une Maison…"
            className="bg-surface h-12 rounded-full border-0 pl-12 text-sm tracking-[0.25px] shadow-none focus-visible:ring-2"
          />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {data.facets.sectors.slice(0, 4).map((facet) => (
            <Chip
              key={facet.value}
              active={filters.sector === facet.value}
              onClick={() => toggle('sector', facet.value)}
              count={facet.count}
            >
              {SECTOR_LABELS[facet.value] ?? facet.value}
            </Chip>
          ))}

          <Chip active={filters.multiSource} onClick={() => set('multiSource', !filters.multiSource)}>
            <Layers className="size-[18px]" />
            Confirmées
          </Chip>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Two numbers, because they answer different questions: what you are
              looking at now, and how many offers exist. Printing only the first
              made a capped page read as the whole database. */}
          <span className="text-muted-foreground text-xs font-medium tracking-[0.5px] tabular-nums">
            {jobs.length.toLocaleString('fr-FR')}
            {data.totalInDatabase > jobs.length && (
              <span className="opacity-60"> / {data.totalInDatabase.toLocaleString('fr-FR')}</span>
            )}
          </span>
          {data.isDemo && (
            <Badge className="bg-accent text-accent-foreground rounded-full border-0 px-3 py-1 text-xs font-medium">
              Démo
            </Badge>
          )}
          <AllFilters
            data={data}
            filters={filters}
            toggle={toggle}
            set={set}
            activeCount={activeCount}
          />
          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="icon"
              onClick={reset}
              aria-label="Effacer les filtres"
              className="hover:bg-surface size-10 shrink-0 rounded-full"
            >
              <X className="size-[18px]" />
            </Button>
          )}
        </div>
      </header>

      {/* Indeed shape: list on the left, the offer itself on the right. Reading
          a posting must not cost the list, since candidates compare. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Liste and Carte are two views of the SAME result set, so they belong
            to the same pane. They used to sit above the detail, which meant
            opening the map hid the offer you were reading — the map answers
            "where are these jobs", never "what is this job". */}
        <div className="bg-surface-low shadow-m3-1 min-h-0 overflow-hidden rounded-[28px]">
          <Tabs defaultValue="list" className="flex h-full flex-col gap-0">
            <TabsList className="bg-surface m-3 h-10 w-fit shrink-0 rounded-full p-1">
              <TabsTrigger value="list" className="rounded-full px-4 text-sm">
                Liste
              </TabsTrigger>
              <TabsTrigger value="map" className="rounded-full px-4 text-sm">
                Carte
              </TabsTrigger>
            </TabsList>

            <TabsContent value="list" className="min-h-0 flex-1">
              <ScrollArea className="h-full">
                {jobs.length === 0 ? (
                  <EmptyState hasFilters={activeCount > 0} onReset={reset} />
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
                        <JobCard
                          job={job}
                          onSelect={() => setSelectedId(job.id)}
                          isSelected={selected?.id === job.id}
                          onSelectCity={(value) => toggle('city', value)}
                          isCityActive={filters.city === job.city}
                        />
                      </motion.li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </TabsContent>

            <TabsContent value="map" className="relative min-h-0 flex-1">
              {/* The map clusters by city, so clicking a marker filters the
                  list by that city — it does not select a single offer. */}
              <JobMap
                jobs={jobs}
                selectedCity={filters.city}
                onSelectCity={(value) => set('city', value)}
              />
              {filters.city && (
                <div className="absolute top-4 left-4 z-[1000]">
                  <Button
                    onClick={() => set('city', null)}
                    className="shadow-m3-2 h-10 rounded-full px-4 text-sm font-medium"
                  >
                    <MapPin className="size-4" />
                    {filters.city}
                    <X className="size-4 opacity-70" />
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* The offer stays put. Switching the left pane to the map no longer
            costs the posting being read. */}
        <div className="bg-surface-low shadow-m3-1 min-h-72 overflow-hidden rounded-[28px] lg:min-h-0">
          {selected ? (
            <JobDetail job={selected} />
          ) : (
            <div className="text-muted-foreground grid h-full place-items-center px-6 text-center text-sm tracking-[0.25px]">
              Sélectionnez une offre pour lire le détail.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Everything that does not fit the toolbar: Maison, group, city, source, recency. */
function AllFilters({
  data,
  filters,
  toggle,
  set,
  activeCount,
}: {
  data: JobsResult;
  filters: Filters;
  toggle: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  set: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  activeCount: number;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          className="hover:bg-surface h-10 rounded-full px-4 text-sm font-medium"
        >
          <SlidersHorizontal className="size-4" />
          Filtres
          {activeCount > 0 && (
            <span className="bg-primary text-primary-foreground ml-1 flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums">
              {activeCount}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent className="bg-surface-low w-full gap-0 border-0 p-0 sm:max-w-md">
        <SheetHeader className="px-6 pt-6 pb-2">
          <SheetTitle className="text-2xl leading-8 font-normal">Filtres</SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100dvh-6rem)] px-6 pb-6">
          <FacetGroup
            title="Contrat"
            items={data.facets.contracts}
            active={filters.contract}
            onToggle={(value) => toggle('contract', value)}
          />
          <FacetGroup
            title="Groupe"
            items={data.facets.groups}
            active={filters.group}
            onToggle={(value) => toggle('group', value)}
          />
          <FacetGroup
            title="Maison"
            items={data.facets.maisons.slice(0, 24)}
            active={filters.maison}
            onToggle={(value) => toggle('maison', value)}
          />
          <FacetGroup
            title="Ville"
            items={data.facets.cities.slice(0, 24)}
            active={filters.city}
            onToggle={(value) => toggle('city', value)}
          />
          <FacetGroup
            title="Source"
            items={data.facets.sources}
            active={filters.source}
            onToggle={(value) => toggle('source', value)}
            label={(value) => SOURCE_LABELS[value] ?? value}
          />

          <section className="py-4">
            <h3 className="text-muted-foreground mb-3 text-xs font-medium tracking-[0.5px] uppercase">
              Publiée depuis
            </h3>
            <div className="flex flex-wrap gap-2">
              {RECENCY_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  active={filters.maxAgeDays === option.value}
                  onClick={() =>
                    set('maxAgeDays', filters.maxAgeDays === option.value ? null : option.value)
                  }
                >
                  <Clock className="size-4" />
                  {option.label}
                </Chip>
              ))}
            </div>
          </section>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function FacetGroup({
  title,
  items,
  active,
  onToggle,
  label,
}: {
  title: string;
  items: { value: string; count: number }[];
  active: string | null;
  onToggle: (value: string) => void;
  label?: (value: string) => string;
}) {
  if (items.length === 0) return null;

  return (
    <>
      <section className="py-4">
        <h3 className="text-muted-foreground mb-3 text-xs font-medium tracking-[0.5px] uppercase">
          {title}
        </h3>
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <Chip
              key={item.value}
              active={active === item.value}
              onClick={() => onToggle(item.value)}
              count={item.count}
            >
              {active === item.value && <Check className="size-4" />}
              {label ? label(item.value) : item.value}
            </Chip>
          ))}
        </div>
      </section>
      <Separator className="bg-border/60" />
    </>
  );
}

/**
 * Material filter chip. shadcn's Button cannot express the selected-container
 * state without being overridden into something else, so the primitive is left
 * untouched rather than fought with.
 */
function Chip({
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
  onSelect,
  isSelected,
  onSelectCity,
  isCityActive,
}: {
  job: JobRow;
  onSelect: () => void;
  isSelected: boolean;
  onSelectCity: (city: string) => void;
  isCityActive: boolean;
}) {
  return (
    <article
      onClick={onSelect}
      className={cn(
        'group cursor-pointer rounded-2xl px-4 py-4 transition-colors',
        isSelected ? 'bg-accent' : 'hover:bg-surface',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="focus-visible:ring-ring inline-flex items-start gap-1.5 rounded-lg text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="text-base leading-6 font-medium tracking-[0.15px]">{job.title}</span>
      </button>

      <div className="mt-1 flex items-center gap-1.5 text-sm leading-5 font-medium tracking-[0.1px]">
        <Building2 className="text-muted-foreground size-4 shrink-0" />
        <span className="truncate">{job.company}</span>
        {job.group && (
          <span className="text-muted-foreground shrink-0 font-normal">· {job.group}</span>
        )}
      </div>

      <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs font-medium tracking-[0.5px]">
        {job.city && (
          <button
            type="button"
            onClick={() => onSelectCity(job.city!)}
            className={cn(
              'focus-visible:ring-ring inline-flex items-center gap-1 rounded-full px-2 py-1 transition-colors focus-visible:ring-2 focus-visible:outline-none',
              isCityActive ? 'bg-accent text-accent-foreground' : 'bg-surface hover:bg-surface-high',
            )}
          >
            <MapPin className="size-3" />
            {job.city}
          </button>
        )}

        {job.contract && <span className="bg-surface rounded-full px-2 py-1">{job.contract}</span>}
        {job.postedAt && <span className="tabular-nums">{relativeDate(job.postedAt)}</span>}

        {job.sourceCount > 1 && (
          <span
            className="inline-flex items-center gap-1"
            title={`Confirmée par ${job.sourceCount} sources — lien employeur retenu`}
          >
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
        <Button onClick={onReset} className="h-10 rounded-full px-6 text-sm font-medium">
          Effacer les filtres
        </Button>
      )}
    </div>
  );
}
