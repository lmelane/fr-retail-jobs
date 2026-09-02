'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SearchPill } from '@/components/search-pill';
import { SiteFooter } from '@/components/site-footer';

/**
 * The landing page — Indeed's home, step one of the two-step funnel.
 *
 * Indeed's own accueil is almost empty: a nav bar, a centered search pill,
 * the wordmark, a one-line title, one CTA. No job list — that is the SECOND
 * step (`/emplois`), reached only after a search. This mirrors that
 * proportion deliberately: the emptiness is the design, not a placeholder
 * waiting to be filled in.
 *
 * Submitting the pill is the only interaction here; it always navigates to
 * `/emplois`, carrying whatever was typed as the initial filters.
 */
export function LandingView() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  // The location field opens on "France" — the country, not a city. The board
  // is France-first (D12), so "France" is the default scope; typing a real city
  // narrows it. The field is a LIEU (pays/région/ville), not a strict city.
  const [city, setCity] = useState('France');

  const handleSubmit = ({ query: q, city: c }: { query: string; city: string }) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    // "France" (or empty) means the whole country — no city filter; the board is
    // already FR by default. Only a real city becomes a `ville` filter.
    const location = c.trim();
    if (location && location.toLowerCase() !== 'france') params.set('ville', location);
    router.push(params.toString() ? `/emplois?${params}` : '/emplois');
  };

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <header className="border-border/70 shrink-0 border-b bg-white">
        <div className="mx-auto flex max-w-[1280px] items-center gap-6 px-4 py-3 sm:px-6">
          <nav className="flex items-center gap-5">
            <Link
              href="/emplois"
              className="text-foreground/60 hover:text-foreground pb-3 text-[15px] font-normal tracking-[0.4px] transition-colors duration-300 ease-catwalks"
            >
              Offres
            </Link>
            <Link
              href="/entreprises"
              className="text-foreground/60 hover:text-foreground pb-3 text-[15px] font-normal tracking-[0.4px] transition-colors duration-300 ease-catwalks"
            >
              Entreprises
            </Link>
          </nav>
        </div>
      </header>

      {/* Body: everything centered in the vertical middle of the viewport,
          Indeed-style — the pill leads, the identity sits quietly below it. */}
      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col items-center justify-center px-4 py-16 sm:px-6">
        <div className="w-full max-w-[900px] px-2 sm:px-0">
          <SearchPill
            size="hero"
            query={query}
            onQueryChange={setQuery}
            city={city}
            onCityChange={setCity}
            onSubmit={handleSubmit}
          />
        </div>

        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fashion-atlas-logo.svg" alt="Fashion Atlas" className="h-8 w-auto sm:h-9" />
          <h1 className="text-foreground max-w-[560px] text-xl font-normal tracking-[0.4px] text-balance sm:text-2xl">
            Trouvez votre poste dans la mode, le luxe & la beauté
          </h1>
          <p className="text-grey-400 max-w-[480px] text-[15px] tracking-[0.4px] text-balance">
            Toutes les offres publiques des Maisons et des jobboards spécialisés, réunies sans doublon.
          </p>

          {/* The strategic CTA also on the home, mirroring Indeed's "Commencer"
              (decision D18): a Catwalks profile for real matching. */}
          <a
            href="https://catwalks.io/inscription?utm_source=fashion-atlas&utm_medium=aggregator"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-primary text-primary-foreground hover:bg-grey-600 mt-2 inline-flex h-11 items-center gap-2 rounded-full px-7 text-[15px] font-normal tracking-[0.4px] transition-colors duration-300 ease-catwalks"
          >
            Matcher mon profil avec Catwalks
          </a>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
