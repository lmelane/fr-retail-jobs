'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { AutocompleteField } from '@/components/search-pill';
import { cn } from '@/lib/utils';
import { companySlug } from '@/lib/company-slug';
import type { CompaniesResult, CompanyFilters, CompanyRow } from '@/lib/companies';

/**
 * Annuaire des Maisons (design_2.md §5.4, réf maisons.html).
 *
 * Répond à « qui recrute » plutôt qu'à « à quoi postuler ». Cliquer une Maison
 * mène à sa fiche `/entreprise/[slug]` (ses offres, ses villes, son groupe).
 *
 * Éditorial : en-tête 4+6, chips de catégorie à compteurs réels, champ de
 * recherche, grille 3/2/1 sans boîte (chaque Maison = filet pointillé haut).
 * Pas de carte (D12).
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

const SearchGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
const ArrowGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden width="16" height="16" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

export function CompaniesView({ data }: { data: CompaniesResult; filters: CompanyFilters }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(params.get('q') ?? '');

  /**
   * Infinite scroll, même forme que la liste d'offres : page 1 rendue serveur,
   * pages suivantes via /api/companies au scroll.
   */
  const [companies, setCompanies] = useState<CompanyRow[]>(data.companies);
  const [loadedPage, setLoadedPage] = useState(data.page);
  const [pageCount, setPageCount] = useState(data.pageCount);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

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
      setLoadError('Le chargement des Maisons suivantes a échoué.');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, loadedPage, pageCount, params]);

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
  const nf = new Intl.NumberFormat('fr-FR');

  return (
    <main className="page bg-paper">
      {/* En-tête 4+6 + chips de catégorie + recherche (§5.4). */}
      <div className="container page-head">
        <div className="g12">
          <h1 className="t-page c4" data-stagger-index="0">Maisons</h1>
          <p className="s5 t-body soft">
            {nf.format(data.total)} Maisons et cabinets, du studio de création à la boutique.
            Chaque fiche regroupe les offres publiques de la Maison, ses villes et son groupe.
          </p>
        </div>

        {/* Chips catégorie : « Toutes » active par défaut, filet pointillé au-
            dessus. À droite, le champ Rechercher (AutocompleteField dans son
            wrapper .field bordé). */}
        <div className="cats rule" style={{ paddingTop: 24 }}>
          <button
            type="button"
            onClick={() => navigate({ secteur: null })}
            className={cn('pill', !activeSector && 'is-active')}
          >
            Toutes <span className="count tabular-nums">{nf.format(data.total)}</span>
          </button>
          {data.sectors.map((facet) => (
            <button
              key={facet.value}
              type="button"
              onClick={() => navigate({ secteur: activeSector === facet.value ? null : facet.value })}
              className={cn('pill', activeSector === facet.value && 'is-active')}
            >
              {SECTOR_LABELS[facet.value] ?? facet.value}{' '}
              <span className="count tabular-nums">{nf.format(facet.count)}</span>
            </button>
          ))}
          <span className="spacer" aria-hidden />
          <form
            className="w-[280px] max-w-full"
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
              icon={<SearchGlyph />}
              placeholder="Rechercher une Maison"
              ariaLabel="Rechercher une Maison"
              className="h-[34px] rounded-(--fa-radius) border border-line"
            />
          </form>
        </div>
      </div>

      {/* Grille 3/2/1 sans boîte. */}
      <div className="container">
        {companies.length === 0 ? (
          <EmptyMaisons
            query={params.get('q')}
            onReset={() => startTransition(() => router.push('/entreprises', { scroll: false }))}
          />
        ) : (
          <>
            <div className={cn('maisons maisons--page', pending && 'opacity-50')}>
              {companies.map((company) => (
                <MaisonCard key={company.id} company={company} />
              ))}
            </div>

            {/* Sentinelle infinite-scroll + bouton « Charger plus » (les deux,
                comme la maquette). La sentinelle déclenche la page suivante au
                scroll ; le bouton reste un fallback explicite. */}
            {loadedPage < pageCount && (
              <div ref={sentinelRef} className="load-more pl-0">
                {loadingMore ? (
                  <span className="t-caption-soft flex items-center gap-2">
                    <Loader2 className="size-5 animate-spin motion-reduce:animate-none" /> Chargement…
                  </span>
                ) : (
                  <button type="button" onClick={() => void loadMore()} className="btn">
                    Charger plus de Maisons <ArrowGlyph />
                  </button>
                )}
              </div>
            )}

            {loadError && (
              <div className="load-more pl-0 flex flex-col items-start gap-2">
                <p className="t-caption-soft">{loadError}</p>
                <button type="button" onClick={() => void loadMore()} className="link-ghost">
                  Réessayer
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

/**
 * Une Maison (§4.8) : logo 56px bordé (monogramme si absent — jamais de logo
 * cassé), nom FA Display 24, « Secteur · Groupe » caption-soft, compteur FA
 * Display + « emplois ouverts », villes body-2 muted sur une ligne. Sans boîte,
 * le filet vient du <a>. Exporté pour réutilisation éventuelle.
 */
export function MaisonCard({ company }: { company: CompanyRow }) {
  const nf = new Intl.NumberFormat('fr-FR');
  const sector = SECTOR_LABELS[company.sector ?? ''] ?? 'Hors référentiel';
  const sectorLine = company.group ? `${sector} · ${company.group}` : sector;
  const monogram = monogramOf(company.name);

  const shownCities = company.cities.slice(0, 4);
  const rest = company.cities.length - shownCities.length;
  const citiesLine =
    shownCities.map((c) => `${c.city} (${c.count})`).join(' · ') + (rest > 0 ? ` +${rest}` : '');

  return (
    <Link className="maison rule" href={`/entreprise/${companySlug(company.name)}`}>
      <span className="logo" aria-hidden>{monogram}</span>
      <span>
        <span className="maison__name t-d2">{company.name}</span>
        <span className="maison__meta">
          <span className="t-caption-soft">{sectorLine}</span>
          <span className="maison__count">
            <span className="t-d2 tabular-nums">{nf.format(company.jobCount)}</span>
            <span className="t-body2">
              {company.jobCount > 1 ? 'emplois ouverts' : 'emploi ouvert'}
            </span>
          </span>
          {citiesLine && <span className="t-body2 muted">{citiesLine}</span>}
        </span>
      </span>
    </Link>
  );
}

/** Monogramme : 1 ou 2 lettres tirées du nom (« Louis Vuitton » → « LV »). */
function monogramOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '·';
  if (words.length === 1) return words[0]!.charAt(0).toUpperCase();
  return (words[0]!.charAt(0) + words[1]!.charAt(0)).toUpperCase();
}

function EmptyMaisons({ query, onReset }: { query: string | null; onReset: () => void }) {
  return (
    <div className="g12 py-[120px]">
      <span className="t-caption green c4">Résultat vide</span>
      <div className="s5">
        <h2 className="t-d1">Aucune Maison ne correspond.</h2>
        {query && <p className="t-body soft mt-3">Aucune Maison ne correspond à « {query} ».</p>}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button type="button" onClick={onReset} className="btn btn--green">
            Voir toutes les Maisons <ArrowGlyph />
          </button>
        </div>
      </div>
    </div>
  );
}
