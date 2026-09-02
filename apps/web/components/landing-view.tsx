'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SearchPill } from '@/components/search-pill';

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
  const [city, setCity] = useState('');

  const handleSubmit = ({ query: q, city: c }: { query: string; city: string }) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (c) params.set('ville', c);
    router.push(params.toString() ? `/emplois?${params}` : '/emplois');
  };

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <header className="border-border/70 shrink-0 border-b bg-white">
        <div className="mx-auto flex max-w-[1280px] items-center gap-6 px-4 py-3 sm:px-6">
          <nav className="flex items-center gap-5">
            <Link
              href="/emplois"
              className="text-foreground/70 hover:text-foreground pb-3 text-[15px] font-medium transition-colors"
            >
              Offres
            </Link>
            <Link
              href="/entreprises"
              className="text-foreground/70 hover:text-foreground pb-3 text-[15px] font-medium transition-colors"
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

        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <span className="text-primary font-heading text-[40px] leading-none font-bold tracking-[-0.02em] sm:text-[52px]">
            Catwalks
          </span>
          <h1 className="text-foreground max-w-[560px] text-xl font-semibold text-balance sm:text-2xl">
            Trouvez votre poste dans la mode, le luxe & la beauté
          </h1>
          <p className="text-muted-foreground max-w-[480px] text-[15px] text-balance">
            Toutes les offres publiques des Maisons et des jobboards spécialisés, réunies sans doublon.
          </p>
        </div>
      </main>
    </div>
  );
}
