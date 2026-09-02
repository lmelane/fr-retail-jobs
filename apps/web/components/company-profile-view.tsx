'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Building2, ExternalLink, Loader2, MapPin, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompanyLogo } from '@/components/company-logo';
import { JobDetail } from '@/components/job-detail';
import { JobCard } from '@/components/jobs-view';
import { AutocompleteField } from '@/components/search-pill';
import { SiteNav } from '@/components/site-nav';
import { cn } from '@/lib/utils';
import type { CompanyProfile } from '@/lib/companies';
import type { JobRow, JobsResult } from '@/lib/jobs';

const CONTRACT_LABELS: Record<string, string> = {
  CDI: 'CDI',
  CDD: 'CDD',
  STAGE: 'Stage',
  ALTERNANCE: 'Alternance',
  INTERIM: 'Intérim',
  FREELANCE: 'Freelance',
  APPRENTICESHIP: 'Apprentissage',
  GRADUATE: 'Graduate',
};

/**
 * One Maison's page, Indeed's `/cmp/<company>` shape (decision D15) — minus
 * the data we do not have (reviews, salaries, executives). What's real: logo,
 * name, sector, open-position count, an "À propos" facts row, and the
 * Maison's offers in the same master-detail layout as /emplois.
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

export function CompanyProfileView({
  profile,
  jobs: initialResult,
}: {
  profile: CompanyProfile;
  jobs: JobsResult;
}) {
  const sectorLabel = profile.sector ? SECTOR_LABELS[profile.sector] ?? profile.sector : null;

  // Indeed always shows a detail when there are results: default to the
  // first offer rather than an empty right pane on first paint.
  const [selectedId, setSelectedId] = useState<string | null>(initialResult.jobs[0]?.id ?? null);

  /**
   * Infinite scroll, same shape as /emplois: page 1 arrives server-rendered
   * in `initialResult`; scrolling near the bottom fetches page 2+ from
   * /api/jobs?maison=<name> and appends it.
   */
  const [jobs, setJobs] = useState<JobRow[]>(initialResult.jobs);
  const [total, setTotal] = useState(initialResult.total);
  const [loadedPage, setLoadedPage] = useState(initialResult.page);
  const [pageCount, setPageCount] = useState(initialResult.pageCount);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);

  /**
   * A light in-page filter (decision, 2026-09-02): a Maison with hundreds of
   * offers is an unnavigable wall without it. Just ville + contrat — enough to
   * cut down 800 offers, without carrying the full /emplois filter bar onto a
   * page already scoped to one company. Both narrow WITHIN this Maison, server-
   * side (via /api/jobs?maison=<name>&ville=&contrat=), so every match is seen,
   * not only the loaded slice.
   */
  const [ville, setVille] = useState('');
  const [contrat, setContrat] = useState<string | null>(null);
  const contractFacets = useMemo(
    () => initialResult.facets.contracts.filter((c) => c.value),
    [initialResult.facets.contracts],
  );

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

  const selected = jobs.find((job) => job.id === selectedId) ?? null;

  // The query for this Maison at the current filter values. `pays=monde` keeps
  // the page world-scoped (a Maison recruits across countries), matching the
  // board's world-by-default scope.
  const buildQuery = useCallback(
    (page: number) => {
      const params = new URLSearchParams({ maison: profile.name, pays: 'monde', page: String(page) });
      if (ville.trim()) params.set('ville', ville.trim());
      if (contrat) params.set('contrat', contrat);
      return params;
    },
    [profile.name, ville, contrat],
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || loadedPage >= pageCount) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/jobs?${buildQuery(loadedPage + 1).toString()}`);
      if (!response.ok) throw new Error(`Le serveur a répondu ${response.status}.`);
      const result = (await response.json()) as JobsResult;
      setJobs((current) => [...current, ...result.jobs]);
      setLoadedPage(result.page);
      setPageCount(result.pageCount);
    } catch {
      setLoadError('Le chargement des offres suivantes a échoué.');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loadedPage, pageCount, buildQuery]);

  /**
   * Reload page 1 whenever the filter changes. The initial (unfiltered) values
   * already came from the server, so this only fires on a real filter change —
   * guarded by `filtersTouched` so the server-rendered first page is not
   * re-fetched on mount.
   */
  const filtersTouched = useRef(false);
  useEffect(() => {
    if (!filtersTouched.current) {
      filtersTouched.current = true;
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const response = await fetch(`/api/jobs?${buildQuery(1).toString()}`);
        if (!response.ok) throw new Error(String(response.status));
        const result = (await response.json()) as JobsResult;
        if (cancelled) return;
        setJobs(result.jobs);
        setTotal(result.total);
        setLoadedPage(result.page);
        setPageCount(result.pageCount);
        setSelectedId(result.jobs[0]?.id ?? null);
        setLoadError(null);
      } catch {
        if (!cancelled) setLoadError('La recherche a échoué.');
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [buildQuery]);

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

  return (
    <div className="bg-background">
      {/* ============ Nav — the shared header, consistent across every page ============ */}
      <header ref={headerRef} className="border-border/70 sticky top-0 z-40 border-b bg-white">
        <div className="mx-auto flex max-w-[1280px] items-center px-4 py-3 sm:px-6">
          <SiteNav active="entreprises" />
        </div>
      </header>

      {/* ============ Company header ============ */}
      <section className="border-border/70 border-b bg-white">
        <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
          <div className="flex items-start gap-4">
            <CompanyLogo name={profile.name} size={64} />
            <div className="min-w-0 flex-1">
              <h1 className="text-foreground text-2xl leading-8 font-normal tracking-[0.4px] uppercase sm:text-[28px]">
                {profile.name}
              </h1>
              <p className="text-grey-400 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] tracking-[0.4px]">
                {sectorLabel && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="size-4 shrink-0 opacity-70" />
                    {sectorLabel}
                  </span>
                )}
                {profile.parentGroup && (
                  <>
                    {sectorLabel && <span className="text-border">•</span>}
                    <span>Groupe · {profile.parentGroup}</span>
                  </>
                )}
              </p>
              <p className="text-foreground mt-2 text-[15px] font-normal tracking-[0.4px] tabular-nums">
                {profile.jobCount.toLocaleString('fr-FR')}{' '}
                {profile.jobCount > 1 ? 'emplois ouverts' : 'emploi ouvert'}
              </p>
            </div>
          </div>

          {/* Light filter bar (ville + contrat), scoped to this Maison — enough
              to navigate a company with hundreds of offers. */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <form
              className="border-border relative flex h-11 w-full max-w-xs items-center rounded-full border bg-white focus-within:ring-2 focus-within:ring-black/20"
              onSubmit={(event) => event.preventDefault()}
            >
              <AutocompleteField
                type="city"
                value={ville}
                onChange={setVille}
                onCommit={setVille}
                icon={<Search className="text-muted-foreground size-[18px] shrink-0" aria-hidden />}
                placeholder="Ville, région ou pays"
                ariaLabel={`Filtrer les offres ${profile.name} par lieu`}
                hero={false}
              />
              {ville && (
                <button
                  type="button"
                  onClick={() => setVille('')}
                  aria-label="Effacer le lieu"
                  className="text-muted-foreground hover:text-foreground mr-3 shrink-0"
                >
                  <X className="size-4" />
                </button>
              )}
            </form>

            {contractFacets.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {contractFacets.map((facet) => {
                  const active = contrat === facet.value;
                  return (
                    <button
                      key={facet.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setContrat(active ? null : facet.value)}
                      className={cn(
                        'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[13px] font-normal tracking-[0.4px] transition-colors duration-300 ease-catwalks',
                        active
                          ? 'border-foreground bg-secondary-container text-on-secondary-container'
                          : 'border-border bg-white hover:bg-surface',
                      )}
                    >
                      {CONTRACT_LABELS[facet.value] ?? facet.value}
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {facet.count.toLocaleString('fr-FR')}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {(ville || contrat) && (
              <button
                type="button"
                onClick={() => {
                  setVille('');
                  setContrat(null);
                }}
                className="text-grey-400 hover:text-foreground ml-1 text-[13px] tracking-[0.4px] underline-offset-2 hover:underline"
              >
                Effacer · {total.toLocaleString('fr-FR')} offre{total > 1 ? 's' : ''}
              </button>
            )}
          </div>

          {/* "À propos" facts row — the honest subset we hold. */}
          <dl className="border-border mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-6 sm:grid-cols-4">
            {sectorLabel && (
              <div>
                <dt className="text-grey-400 text-xs tracking-[1px] uppercase">Secteur</dt>
                <dd className="text-foreground mt-1 text-sm font-normal tracking-[0.4px]">{sectorLabel}</dd>
              </div>
            )}
            {profile.parentGroup && (
              <div>
                <dt className="text-grey-400 text-xs tracking-[1px] uppercase">Groupe</dt>
                <dd className="text-foreground mt-1 text-sm font-normal tracking-[0.4px]">{profile.parentGroup}</dd>
              </div>
            )}
            <div>
              <dt className="text-grey-400 text-xs tracking-[1px] uppercase">Nombre d’offres</dt>
              <dd className="text-foreground mt-1 text-sm font-normal tracking-[0.4px] tabular-nums">
                {profile.jobCount.toLocaleString('fr-FR')}
              </dd>
            </div>
            {profile.cities.length > 0 && (
              <div className="col-span-2 sm:col-span-2">
                <dt className="text-grey-400 text-xs tracking-[1px] uppercase">Villes</dt>
                <dd className="text-foreground mt-1 flex items-start gap-1.5 text-sm font-normal tracking-[0.4px]">
                  <MapPin className="mt-0.5 size-3.5 shrink-0 opacity-70" />
                  <span>
                    {profile.cities
                      .slice(0, 6)
                      .map((c) => `${c.city} (${c.count})`)
                      .join(' · ')}
                    {profile.cities.length > 6 && ` +${profile.cities.length - 6}`}
                  </span>
                </dd>
              </div>
            )}
            {profile.careersUrl && (
              <div>
                <dt className="text-grey-400 text-xs tracking-[1px] uppercase">Site carrière</dt>
                <dd className="mt-1 text-sm font-normal tracking-[0.4px]">
                  <a
                    href={profile.careersUrl}
                    target="_blank"
                    rel="noopener"
                    className="text-foreground inline-flex items-center gap-1 hover:underline"
                  >
                    Voir le site
                    <ExternalLink className="size-3.5" />
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      {/* ============ Offers, same master-detail shape as /emplois ============ */}
      <div className="mx-auto grid w-full max-w-[1280px] grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,470px)_minmax(0,1fr)] lg:items-start">
        <div className={cn(selected ? 'hidden lg:block' : 'block')}>
          {jobs.length === 0 ? (
            <div className="grid place-items-center px-6 py-16 text-center">
              <p className="text-foreground text-sm font-normal tracking-[0.4px]">
                Aucune offre ouverte chez {profile.name} pour l’instant.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2 pb-2">
              {jobs.map((job) => (
                <li key={job.id}>
                  <JobCard
                    job={job}
                    onSelect={() => setSelectedId(job.id)}
                    isSelected={selected?.id === job.id}
                  />
                </li>
              ))}

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
            className="border-border bg-card relative flex flex-col overflow-hidden rounded-[16px] border lg:sticky lg:top-(--detail-top) lg:max-h-(--detail-max-height)"
            style={
              headerHeight
                ? ({
                    '--detail-top': `${headerHeight + 16}px`,
                    '--detail-max-height': `calc(100vh - ${headerHeight + 32}px)`,
                  } as React.CSSProperties)
                : undefined
            }
          >
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
