'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchPill } from '@/components/search-pill';
import { SiteFooter } from '@/components/site-footer';
import { SiteNav } from '@/components/site-nav';
import { RotatingWord } from '@/components/rotating-word';

/**
 * The landing — the Catwalks hero's spirit, rewritten for the aggregator
 * (decided 2026-09-02).
 *
 * Where Catwalks sells matching into the RIGHT Maison, Fashion Atlas sells
 * EXHAUSTIVENESS: every public offer across Mode · Luxe · Beauté · Retail, in
 * one place, searchable. So the hero leads with the search pill and states the
 * real breadth (offers · Maisons · countries — never invented numbers). The
 * rotating word runs over the families we cover, conveying that breadth at a
 * glance. The Catwalks matching CTA stays, but quieter: the search is the
 * aggregator's own promise; matching is the bridge, not the headline (D18).
 */

// The families we actually aggregate — the rotating word only names universes
// where offers really exist, so the breadth it promises is honest.
const FAMILIES = [
  'la mode',
  'le luxe',
  'la beauté',
  'la joaillerie',
  'l’horlogerie',
  'le retail',
  'la vente',
  'le merchandising',
] as const;

export function LandingView({
  stats,
}: {
  stats: { offers: number; companies: number; countries: number };
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  // Empty by default (placeholder "Ville, région ou pays"): the board is world
  // by default (revises D12), so pre-filling "France" would misstate the scope.
  const [city, setCity] = useState('');

  const handleSubmit = ({ query: q, city: c }: { query: string; city: string }) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    const location = c.trim();
    if (location) params.set('ville', location);
    router.push(params.toString() ? `/emplois?${params}` : '/emplois');
  };

  const nf = new Intl.NumberFormat('fr-FR');

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <header className="border-border/70 shrink-0 border-b bg-white">
        <div className="mx-auto flex max-w-[1280px] items-center px-4 py-3 sm:px-6">
          <SiteNav active="offres" />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col items-center justify-center px-4 py-16 sm:px-6">
        {/* Overline: the positioning, like Catwalks' "Luxe · Mode · Beauté". */}
        <p className="text-grey-400 mb-5 text-[13px] uppercase tracking-[2px]">
          Mode · Luxe · Beauté · Horlogerie · Retail
        </p>

        {/* H1 + rotating word — the phrase is masked from assistive tech (the
            pill rotates); the full sentence is provided once, visually hidden. */}
        <h1 className="text-foreground mb-3 max-w-[820px] text-center text-3xl font-normal leading-tight tracking-[0.4px] text-balance sm:text-[44px] sm:leading-[1.15]">
          <span aria-hidden="true">
            Toutes les offres de{' '}
            {/* The pill and its trailing comma stay on one line — a break
                between them would strand the comma at the start of a line. */}
            <span className="whitespace-nowrap">
              <RotatingWord words={FAMILIES} />,
            </span>{' '}
            réunies en un seul endroit.
          </span>
          <span className="sr-only">
            Toutes les offres de la mode, du luxe, de la beauté, de l’horlogerie et
            du retail, réunies en un seul endroit.
          </span>
        </h1>

        <p className="text-grey-400 mb-10 max-w-[560px] text-center text-[15px] tracking-[0.4px] text-balance sm:text-base">
          Les offres publiques des Maisons et des jobboards spécialisés, agrégées
          sans doublon, avec le lien de candidature direct.
        </p>

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

        {/* The aggregator's proof: real counts, or nothing if the DB is down. */}
        {stats.offers > 0 && (
          <dl className="mt-10 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-center">
            <Stat value={nf.format(stats.offers)} label="offres actives" />
            <Stat value={nf.format(stats.companies)} label="Maisons" />
            {stats.countries > 1 && <Stat value={nf.format(stats.countries)} label="pays" />}
          </dl>
        )}

        {/* The Catwalks matching bridge — present, but quiet (D18): the search is
            Fashion Atlas' own promise; matching is the honest onward step. */}
        <a
          href="https://catwalks.io/inscription?utm_source=fashion-atlas&utm_medium=aggregator&utm_campaign=landing"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground/70 hover:text-foreground mt-10 text-[14px] tracking-[0.4px] underline-offset-4 transition-colors duration-300 ease-catwalks hover:underline"
        >
          Ou laissez Catwalks matcher votre profil avec les Maisons qui recrutent →
        </a>
      </main>

      <SiteFooter />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <dt className="sr-only">{label}</dt>
      <dd className="text-foreground text-2xl font-normal tracking-[0.4px] tabular-nums sm:text-[28px]">
        {value}
      </dd>
      <span aria-hidden="true" className="text-grey-400 mt-0.5 text-[13px] tracking-[0.4px]">
        {label}
      </span>
    </div>
  );
}
