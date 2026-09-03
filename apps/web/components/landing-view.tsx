'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SearchPill } from '@/components/search-pill';
import { companySlug } from '@/lib/company-slug';
import { offerPath } from '@/lib/offer-url';
import { displayTitle, relativeDate, contractLabel } from '@/lib/format';
import type { CompanyRow } from '@/lib/companies';
import type { JobRow } from '@/lib/jobs';

/**
 * Home (design_2.md §5.1, réf home.html). Editorial : hero vert-nuit + grain,
 * barre de recherche posée sur le bas du hero, intro 4+6, chiffres clés, secteurs,
 * Maisons qui recrutent, dernières offres, bandeau matching. Données réelles.
 */

const SECTOR_LABELS: Record<string, string> = {
  FASHION: 'Mode', LUXURY: 'Luxe', BEAUTY: 'Beauté', JEWELRY_WATCHES: 'Horlogerie & Joaillerie',
  RETAIL: 'Retail', SUPPLIER: 'Fournisseurs', MEDIA_AGENCY: 'Médias', RECRUITER: 'Cabinets',
};
const HERO_SECTORS = ['FASHION', 'LUXURY', 'BEAUTY', 'JEWELRY_WATCHES', 'RETAIL'];

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="16" height="16"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

export function LandingView({
  stats,
  sectors,
  maisons,
  latestOffers,
}: {
  stats: { offers: number; companies: number; countries: number; newCompaniesThisWeek: number };
  sectors: { value: string; count: number }[];
  maisons: CompanyRow[];
  latestOffers: JobRow[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const nf = new Intl.NumberFormat('fr-FR');

  const sectorCount = (v: string) => sectors.find((s) => s.value === v)?.count ?? 0;

  return (
    <main>
      {/* ————— Hero (vert-nuit + grain, réf home.html) ————— */}
      <section
        aria-labelledby="hero-title"
        className="relative grid place-items-center overflow-hidden text-center text-white"
        style={{
          height: 680,
          background:
            'radial-gradient(1200px 520px at 68% 18%,rgba(72,112,86,.55),transparent 60%),radial-gradient(800px 600px at 18% 85%,rgba(28,60,42,.7),transparent 65%),radial-gradient(500px 300px at 50% 110%,rgba(120,140,110,.35),transparent 70%),linear-gradient(180deg,#0E2A1C 0%,#0A1F15 55%,#06140D 100%)',
        }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{
          backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .08 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`,
          opacity: 0.9,
        }} />
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'rgba(0,10,5,.42)' }} />
        <div className="relative z-[1] grid justify-items-center gap-6 px-6" style={{ paddingTop: 'var(--header-h)', maxWidth: 1040 }}>
          <p className="t-caption opacity-90" data-stagger-index="0">Mode · Luxe · Beauté · Horlogerie · Retail</p>
          {/* DEC-1 : la promesse est le compteur réel, jamais « toutes ».
              Base indisponible (0) -> formulation sans chiffre ni absolu. */}
          <h1 id="hero-title" className="t-hero" data-stagger-index="1">
            {stats.companies > 0 ? (
              <>Les offres de {nf.format(stats.companies)} Maisons,<br />réunies.</>
            ) : (
              <>Les offres du luxe,<br />réunies.</>
            )}
          </h1>
        </div>
      </section>

      {/* ————— Barre de recherche posée sur le bas du hero — SearchPill pour
          retrouver l'autocomplete (régression corrigée : les inputs nus de la
          refonte avaient perdu les suggestions que l'ancienne home avait). ————— */}
      <div className="container relative z-[2] -mt-7 text-ink" data-stagger-index="2">
        <SearchPill
          size="hero"
          query={query}
          onQueryChange={setQuery}
          city={city}
          onCityChange={setCity}
          onSubmit={({ query: q, city: c }) => {
            const p = new URLSearchParams();
            if (q) p.set('q', q);
            if (c) p.set('ville', c);
            router.push(p.toString() ? `/emplois?${p}` : '/emplois');
          }}
        />
      </div>

      {/* ————— Intro éditoriale (4+6) ————— */}
      <section className="container section" aria-labelledby="intro-title">
        <div className="g12">
          <h2 id="intro-title" className="t-d1 c4" data-stagger-index="0">Un seul moteur.</h2>
          <div className="s5 t-body soft space-y-4" data-stagger-index="1">
            <p>Les offres publiques des Maisons et des jobboards spécialisés, agrégées sans doublon, avec le lien de candidature direct.</p>
            <p>Chaque offre est rattachée à sa Maison, à son groupe et à sa ville. Rien n’est réécrit : vous lisez l’annonce telle que la Maison l’a publiée.</p>
            {/* Pas de bouton « Comment ça marche » : /a-propos n'existe pas et
                les deux paragraphes ci-dessus expliquent déjà le moteur. On ne
                pointe pas vers un 404 ni vers catwalks.io (autre produit). */}
          </div>
        </div>
      </section>

      {/* ————— Chiffres clés ————— */}
      {stats.offers > 0 && (
        <section className="container section" aria-label="Chiffres clés">
          <div className="g12">
            <Stat value={nf.format(stats.offers)} label="offres actives" staggerIndex={0} />
            <Stat
              value={nf.format(stats.companies)}
              label={
                stats.newCompaniesThisWeek > 0
                  ? `Maisons, +${nf.format(stats.newCompaniesThisWeek)} cette semaine`
                  : 'Maisons'
              }
              staggerIndex={1}
            />
            {stats.countries > 1 && <Stat value={nf.format(stats.countries)} label="pays" staggerIndex={2} />}
          </div>
        </section>
      )}

      {/* ————— Explorer par secteur ————— */}
      <section className="container section" aria-labelledby="sectors-title">
        <div className="section-head">
          <h2 id="sectors-title" className="t-d1" data-stagger-index="0">Explorer par secteur.</h2>
        </div>
        <div className="grid grid-cols-2 gap-x-10 gap-y-6 md:grid-cols-5">
          {HERO_SECTORS.map((s) => (
            <Link key={s} href={`/emplois?secteur=${s}`} className="rule block pt-6 group" data-stagger-index={HERO_SECTORS.indexOf(s) % 5}>
              <span className="t-d2 block group-hover:underline group-hover:underline-offset-4">{SECTOR_LABELS[s]}</span>
              <span className="t-caption-soft mt-2 block">{nf.format(sectorCount(s))} offres</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ————— Maisons qui recrutent ————— */}
      {maisons.length > 0 && (
        <section className="container section" aria-labelledby="maisons-title">
          <div className="section-head">
            <h2 id="maisons-title" className="t-d1" data-stagger-index="0">Maisons qui recrutent.</h2>
            <Link href="/entreprises" className="btn btn--green">Voir les Maisons <Arrow /></Link>
          </div>
          <div className="grid grid-cols-1 gap-x-10 md:grid-cols-3">
            {maisons.map((m, i) => (
              <Link key={m.id} href={`/entreprise/${companySlug(m.name)}`} className="rule block py-6 group" data-stagger-index={i % 3}>
                <span className="t-d2 block group-hover:underline group-hover:underline-offset-4">{m.name}</span>
                {m.sector && <span className="t-caption-soft mt-1 block">{SECTOR_LABELS[m.sector] ?? m.sector}</span>}
                <span className="t-body2 muted mt-2 block tabular-nums">{nf.format(m.jobCount)} {m.jobCount > 1 ? 'emplois ouverts' : 'emploi ouvert'}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ————— Dernières offres ————— */}
      {latestOffers.length > 0 && (
        <section className="container section" aria-labelledby="latest-title">
          <div className="section-head">
            <h2 id="latest-title" className="t-d1" data-stagger-index="0">Dernières offres.</h2>
          </div>
          <ul>
            {latestOffers.map((o) => (
              <li key={o.id} className="rule-b">
                <Link href={offerPath(o)} className="block py-5 hover:bg-paper-alt">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="t-caption">{o.company}{o.group ? <span className="t-caption-soft"> · {o.group}</span> : null}</span>
                    <span className="t-caption-soft shrink-0">{relativeDate(o.postedAt)}</span>
                  </div>
                  <p className="t-d2 mt-1">{displayTitle(o.title)}</p>
                  <p className="t-body2 muted mt-1">
                    {[o.city, contractLabel(o.contract)].filter(Boolean).join(' · ')}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <Link href="/emplois" className="btn">Voir les {nf.format(stats.offers)} offres <Arrow /></Link>
          </div>
        </section>
      )}

      {/* ————— Bandeau Matching (vert-nuit) ————— */}
      <section className="mt-[120px] py-[120px] text-white" style={{ background: 'var(--fa-green-night)' }} aria-labelledby="matching-title">
        <div className="container g12">
          <h2 id="matching-title" className="t-d1 c4 text-white">Laissez les Maisons venir à vous.</h2>
          <div className="s5">
            <p className="t-body" style={{ color: 'rgba(255,255,255,.8)' }}>
              Créez votre profil Catwalks et laissez le matching vous relier aux Maisons qui recrutent votre métier.
            </p>
            <a href="https://catwalks.io/inscription?utm_source=fashion-atlas&utm_medium=aggregator&utm_campaign=home" target="_blank" rel="noopener noreferrer" className="btn btn--inverse mt-6">
              Créer mon profil Catwalks <Arrow />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ value, label, staggerIndex }: { value: string; label: string; staggerIndex?: number }) {
  return (
    <div className="c4 rule pt-6" data-stagger-index={staggerIndex}>
      <span className="t-number block">{value}</span>
      <span className="t-caption mt-3 block">{label}</span>
    </div>
  );
}
