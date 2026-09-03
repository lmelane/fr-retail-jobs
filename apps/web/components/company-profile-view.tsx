'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CompanyLogo } from '@/components/company-logo';
import Link from 'next/link';
import { Loader2, X } from 'lucide-react';
import { JobDetail } from '@/components/job-detail';
import { JobCard } from '@/components/jobs-view';
import { AutocompleteField } from '@/components/search-pill';
import { cn } from '@/lib/utils';
import type { CompanyProfile } from '@/lib/companies';
import type { JobRow, JobsResult } from '@/lib/jobs';

/**
 * Fiche Maison `/entreprise/[slug]` (design_2.md §5.5, réf maison.html).
 *
 * Ce qu'on a réellement (D15) : logo, nom, secteur, groupe, nombre d'offres,
 * villes, lien carrières — pas d'avis, de salaires agrégés ni de dirigeants
 * (on ne les invente pas). Hero vert-nuit + grain (comme la home, tant qu'il
 * n'y a pas de photo Maison), chiffres clés, barre légère (ville + contrat,
 * D20), la même liste de cartes offre que /emplois (composant partagé), et une
 * grille « Par ville » vers /emplois filtré.
 */

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

// Fond vert-nuit + grain, identique au hero de la home (réf home.html).
const HERO_BG =
  'radial-gradient(1200px 520px at 68% 18%,rgba(14,84,96,.5),transparent 60%),radial-gradient(800px 600px at 18% 85%,rgba(4,51,59,.7),transparent 65%),radial-gradient(500px 300px at 50% 110%,rgba(90,130,138,.3),transparent 70%),linear-gradient(180deg,#04333B 0%,#022026 55%,#011317 100%)';
const GRAIN_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .08 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";

const SearchGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
const OutGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden width="16" height="16" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M8 7h9v9" /></svg>
);


export function CompanyProfileView({
  profile,
  jobs: initialResult,
}: {
  profile: CompanyProfile;
  jobs: JobsResult;
}) {
  const sectorLabel = profile.sector ? SECTOR_LABELS[profile.sector] ?? profile.sector : null;
  const heroCaption = [sectorLabel, profile.parentGroup].filter(Boolean).join(' · ');
  const nf = new Intl.NumberFormat('fr-FR');

  const [selectedId, setSelectedId] = useState<string | null>(initialResult.jobs[0]?.id ?? null);

  const [jobs, setJobs] = useState<JobRow[]>(initialResult.jobs);
  const [total, setTotal] = useState(initialResult.total);
  const [loadedPage, setLoadedPage] = useState(initialResult.page);
  const [pageCount, setPageCount] = useState(initialResult.pageCount);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);

  // Barre légère (D20) : ville + contrat, scopée à cette Maison, côté serveur.
  const [ville, setVille] = useState('');
  const [contrat, setContrat] = useState<string | null>(null);
  const contractFacets = useMemo(
    () => initialResult.facets.contracts.filter((c) => c.value),
    [initialResult.facets.contracts],
  );

  // Naviguer d'une Maison à une autre côté client (Link, sans key) réutilise
  // cette instance : sans re-sync, la liste d'offres, le total et le détail
  // resteraient ceux de la Maison précédente pendant que le hero/les stats,
  // qui lisent `profile` directement, se mettent à jour. On re-sème donc l'état
  // dérivé du serveur quand `initialResult` change (même garde que jobs-view /
  // companies-view). Les filtres légers (ville/contrat) sont aussi remis à zéro :
  // ils étaient scopés à la Maison précédente.
  useEffect(() => {
    setJobs(initialResult.jobs);
    setTotal(initialResult.total);
    setLoadedPage(initialResult.page);
    setPageCount(initialResult.pageCount);
    setSelectedId(initialResult.jobs[0]?.id ?? null);
    setLoadError(null);
    setVille('');
    setContrat(null);
    // La page 1 de la nouvelle Maison vient déjà du serveur (initialResult) :
    // on désarme la garde pour que le re-set de ville/contrat ci-dessus ne
    // déclenche pas un re-fetch redondant de cette même page 1.
    filtersTouched.current = false;
  }, [initialResult]);

  // Mesure de l'offset sticky du détail (§5.2) : hauteur du header global fixe.
  const [detailTop, setDetailTop] = useState(0);
  useEffect(() => {
    const read = () => {
      const h = getComputedStyle(document.documentElement).getPropertyValue('--header-h');
      setDetailTop(parseInt(h) || 114);
    };
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);

  const selected = jobs.find((job) => job.id === selectedId) ?? null;

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

  const filtered = ville.trim() !== '' || contrat !== null;

  return (
    <main className="bg-paper">
      {/* ————— Hero Maison (vert-nuit + grain tant qu'il n'y a pas de photo) ————— */}
      <section className="hero--maison relative overflow-hidden text-white" style={{ background: HERO_BG }} aria-labelledby="maison-title">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: GRAIN_URL, opacity: 0.9 }} />
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'rgba(0,10,5,.42)' }} />
        <div className="container relative z-[1] flex h-full items-end gap-6 pb-12">
          {/* Logo Maison (D9, réactivé par la review) — monogramme en repli. */}
          <CompanyLogo name={profile.name} size={96} />
          <div>
            {heroCaption && <p className="t-caption mb-2" style={{ opacity: 0.85 }}>{heroCaption}</p>}
            <h1 className="t-hero" id="maison-title" style={{ fontSize: 'clamp(2.75rem,5.5vw,5rem)', textAlign: 'left' }}>
              {profile.name}
            </h1>
          </div>
        </div>
      </section>

      {/* Lien carrières (l'intro éditoriale est masquée : aucune description
          ingérée — on n'invente pas de texte). Affiché seulement si l'URL existe. */}
      {profile.careersUrl && (
        <section className="container" style={{ paddingTop: 40 }}>
          <a className="btn btn--green" href={profile.careersUrl} target="_blank" rel="noopener noreferrer">
            Site carrières {profile.name} <OutGlyph />
          </a>
        </section>
      )}

      {/* ————— Chiffres clés (offres · villes ; pas de « pays » : non exposé) ————— */}
      <section className="container stats stats--inline" style={{ paddingTop: 80 }} aria-label={`Chiffres clés ${profile.name}`}>
        <div className="g12">
          <div className="c4 stat rule">
            <span className="t-number tabular-nums">{nf.format(profile.jobCount)}</span>
            <span className="t-caption">offres ouvertes</span>
          </div>
          {profile.cities.length > 0 && (
            <div className="c4 stat rule">
              <span className="t-number tabular-nums">{nf.format(profile.cities.length)}</span>
              <span className="t-caption">{profile.cities.length > 1 ? 'villes' : 'ville'}</span>
            </div>
          )}
        </div>
      </section>

      {/* ————— Offres chez la Maison : barre légère + liste partagée ————— */}
      <section className="container section" style={{ paddingTop: 96 }} aria-labelledby="offres-title">
        <div className="section-head">
          <h2 className="t-d1" id="offres-title">Offres chez {profile.name}</h2>
        </div>

        {/* Barre légère D20 : ville (autocomplete) + pills contrat, scopée. */}
        <div className="filters" style={{ margin: '0 0 12px' }}>
          <form className="w-[240px] max-w-full" onSubmit={(e) => e.preventDefault()}>
            <AutocompleteField
              type="city"
              value={ville}
              onChange={setVille}
              onCommit={setVille}
              icon={<SearchGlyph />}
              placeholder="Ville, région ou pays"
              ariaLabel={`Filtrer les offres ${profile.name} par lieu`}
              className="h-[34px] rounded-(--fa-radius) border border-line"
            />
          </form>
          {contractFacets.map((facet) => {
            const active = contrat === facet.value;
            return (
              <button
                key={facet.value}
                type="button"
                aria-pressed={active}
                onClick={() => setContrat(active ? null : facet.value)}
                className={cn('pill', active && 'is-active')}
              >
                {CONTRACT_LABELS[facet.value] ?? facet.value}{' '}
                <span className="count tabular-nums">{nf.format(facet.count)}</span>
              </button>
            );
          })}
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setVille('');
                setContrat(null);
              }}
              className="link-ghost"
            >
              Réinitialiser
            </button>
          )}
          <span className="spacer" aria-hidden />
          <span className="t-caption-soft tabular-nums">{nf.format(total)} offres</span>
        </div>

        {/* Split-view identique à /emplois (composant JobCard/JobDetail partagé). */}
        <div className="split">
          <section aria-label="Résultats">
            {jobs.length === 0 ? (
              <div className="py-16 text-center">
                <p className="t-d2">Aucune offre ouverte chez {profile.name}{filtered ? ' pour ces filtres' : ''}.</p>
              </div>
            ) : (
              <ul>
                {jobs.map((job) => (
                  <li key={job.id} className="rule">
                    <JobCard
                      job={job}
                      onSelect={() => setSelectedId(job.id)}
                      isSelected={selected?.id === job.id}
                    />
                  </li>
                ))}

                {loadedPage < pageCount && (
                  <li ref={sentinelRef} aria-hidden={!loadingMore} className="load-more grid place-items-center">
                    {loadingMore && (
                      <span className="t-caption-soft flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> Chargement…
                      </span>
                    )}
                  </li>
                )}

                {loadError && (
                  <li className="load-more grid place-items-center gap-2 text-center">
                    <p className="t-caption-soft">{loadError}</p>
                    <button type="button" onClick={() => void loadMore()} className="link-ghost">
                      Réessayer
                    </button>
                  </li>
                )}
              </ul>
            )}
          </section>

          {selected && <span className="rule-v hidden lg:block" aria-hidden />}

          {selected && (
            <div
              className="detail"
              style={
                detailTop
                  ? ({ top: `calc(${detailTop}px + 16px)`, maxHeight: `calc(100vh - ${detailTop}px - 32px)` } as React.CSSProperties)
                  : undefined
              }
            >
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label="Retour à la liste des offres"
                className="mb-4 inline-flex items-center gap-2 text-ink-muted hover:text-ink lg:hidden"
              >
                <X className="size-4" /> <span className="t-ui-small">Retour</span>
              </button>
              <JobDetail job={selected} />
            </div>
          )}
        </div>
      </section>

      {/* ————— Par ville : cellules → /emplois filtré ————— */}
      {profile.cities.length > 0 && (
        <section className="container section" style={{ paddingTop: 96, paddingBottom: 120 }} aria-labelledby="villes-title">
          <div className="section-head">
            <h2 className="t-d1" id="villes-title">Par ville</h2>
          </div>
          <div className="maisons">
            {profile.cities.slice(0, 12).map((c) => (
              <Link
                key={c.city}
                className="maison rule"
                style={{ gridTemplateColumns: '1fr' }}
                href={`/emplois?maison=${encodeURIComponent(profile.name)}&ville=${encodeURIComponent(c.city)}`}
              >
                <span>
                  <span className="maison__name t-d2">{c.city}</span>
                  <span className="maison__meta">
                    <span className="maison__count">
                      <span className="t-d2 tabular-nums">{nf.format(c.count)}</span>
                      <span className="t-body2">{c.count > 1 ? 'offres' : 'offre'}</span>
                    </span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
