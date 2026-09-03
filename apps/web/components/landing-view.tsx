'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { companySlug } from '@/lib/company-slug';
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
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden width="18" height="18"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
);
const PinIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="18" height="18"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
);

export function LandingView({
  stats,
  sectors,
  maisons,
  latestOffers,
}: {
  stats: { offers: number; companies: number; countries: number };
  sectors: { value: string; count: number }[];
  maisons: CompanyRow[];
  latestOffers: JobRow[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [city, setCity] = useState('');
  const nf = new Intl.NumberFormat('fr-FR');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (query.trim()) p.set('q', query.trim());
    if (city.trim()) p.set('ville', city.trim());
    router.push(p.toString() ? `/emplois?${p}` : '/emplois');
  };

  const sectorCount = (v: string) => sectors.find((s) => s.value === v)?.count ?? 0;

  return (
    <>
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
          <p className="t-caption opacity-90">Mode · Luxe · Beauté · Horlogerie · Retail</p>
          <h1 id="hero-title" className="t-hero">Toutes les offres<br />du luxe, réunies.</h1>
        </div>
      </section>

      {/* ————— Barre de recherche posée sur le bas du hero ————— */}
      <div className="container relative z-[2] -mt-7">
        <form role="search" onSubmit={submit}
          className="mx-auto grid h-14 max-w-[760px] grid-cols-[55fr_30fr_auto] rounded border border-ink bg-paper text-ink focus-within:border-green">
          <label className="flex items-center gap-2 px-4">
            <span className="text-ink-muted"><SearchIcon /></span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Poste, Maison, mot-clé…" aria-label="Poste, Maison ou mot-clé" className="t-ui w-full bg-transparent outline-none placeholder:text-ink-muted" />
          </label>
          <label className="flex items-center gap-2 border-l border-ink/15 px-4">
            <span className="text-ink-muted"><PinIcon /></span>
            <input type="search" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ville, région ou pays" aria-label="Ville, région ou pays" className="t-ui w-full bg-transparent outline-none placeholder:text-ink-muted" />
          </label>
          <button type="submit" className="btn btn--primary rounded-l-none border-0 px-6">Rechercher <Arrow /></button>
        </form>
      </div>

      {/* ————— Intro éditoriale (4+6) ————— */}
      <section className="container section" aria-labelledby="intro-title">
        <div className="g12">
          <h2 id="intro-title" className="t-d1 c4">Un seul moteur.</h2>
          <div className="s5 t-body soft space-y-4">
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
            <Stat value={nf.format(stats.offers)} label="offres actives" />
            <Stat value={nf.format(stats.companies)} label="Maisons" />
            {stats.countries > 1 && <Stat value={nf.format(stats.countries)} label="pays" />}
          </div>
        </section>
      )}

      {/* ————— Explorer par secteur ————— */}
      <section className="container section" aria-labelledby="sectors-title">
        <div className="section-head">
          <h2 id="sectors-title" className="t-d1">Explorer par secteur.</h2>
        </div>
        <div className="grid grid-cols-2 gap-x-10 gap-y-6 md:grid-cols-5">
          {HERO_SECTORS.map((s) => (
            <Link key={s} href={`/emplois?secteur=${s}`} className="rule block pt-6 group">
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
            <h2 id="maisons-title" className="t-d1">Maisons qui recrutent.</h2>
            <Link href="/entreprises" className="btn btn--green">Toutes les Maisons <Arrow /></Link>
          </div>
          <div className="grid grid-cols-1 gap-x-10 md:grid-cols-3">
            {maisons.map((m) => (
              <Link key={m.id} href={`/entreprise/${companySlug(m.name)}`} className="rule block py-6 group">
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
            <h2 id="latest-title" className="t-d1">Dernières offres.</h2>
          </div>
          <ul>
            {latestOffers.map((o) => (
              <li key={o.id} className="rule-b">
                <Link href={`/offre/${o.id}`} className="block py-5 hover:bg-paper-alt">
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
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="c4 rule pt-6">
      <span className="t-number block">{value}</span>
      <span className="t-caption mt-3 block">{label}</span>
    </div>
  );
}
