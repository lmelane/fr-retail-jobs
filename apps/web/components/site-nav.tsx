'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * Shared fixed two-tier header (design_2.md §4.1). One instance in the layout,
 * on every route. Mode and active section are deduced from the pathname (no prop
 * passed by pages):
 *   - hero pages (home, /maisons/:slug, /matching) start transparent over the
 *     hero photo (white text) then turn opaque white past scrollY 40 (250ms on
 *     background/color only — never height, so no layout jump);
 *   - engine/list pages are white from the start.
 * Height is exposed as --header-h so the /emplois sticky search bar can anchor
 * to it (top: var(--header-h)).
 */

const HERO_ROUTES = [/^\/$/, /^\/maisons\/[^/]+$/, /^\/entreprise\/[^/]+$/];

/**
 * Nav entries. « Offres » et « Maisons » sont des routes internes (Maisons =
 * /entreprises, renommée en UI seulement). « Matching » et « À propos » sont
 * des liens EXTERNES vers catwalks.io (↗, nouvel onglet) : le compte, le CV et
 * le matching vivent sur Catwalks, pas sur Fashion Atlas (D14/D18) — pas de
 * page interne qui promettrait un service qu'on ne rend pas. Décidé par Loïc.
 */
type NavItem =
  | { label: string; href: string; external?: false; match: (p: string) => boolean }
  | { label: string; href: string; external: true };
const NAV: NavItem[] = [
  { label: 'Offres', href: '/emplois', match: (p) => p.startsWith('/emplois') || p.startsWith('/offre') },
  { label: 'Maisons', href: '/entreprises', match: (p) => p.startsWith('/entreprises') || p.startsWith('/maisons') || p.startsWith('/entreprise') },
  { label: 'Matching', href: 'https://catwalks.io/inscription?utm_source=fashion-atlas&utm_medium=aggregator&utm_campaign=nav-matching', external: true },
  { label: 'À propos', href: 'https://catwalks.io', external: true },
];

const ArrowUpRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="14" height="14"><path d="M7 17 17 7M8 7h9v9" /></svg>
);
const ChevronDown = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden width="14" height="14" className={className}><path d="m6 9 6 6 6-6" /></svg>
);
const Burger = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden width="20" height="20"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
);
const Close = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden width="20" height="20"><path d="M18 6 6 18M6 6l12 12" /></svg>
);

export function SiteNav() {
  const pathname = usePathname() ?? '/';
  const isHero = HERO_ROUTES.some((re) => re.test(pathname));
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!isHero) return;
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [isHero]);

  // Close the mobile menu on route change + Escape.
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const onPhoto = isHero && !scrolled;

  return (
    <>
      <header
        data-hero={isHero ? '1' : '0'}
        className={cn(
          'fixed inset-x-0 top-0 z-[100] h-(--header-h) transition-[background-color,color] duration-[250ms] ease-[cubic-bezier(.645,.045,.355,1)]',
          onPhoto ? 'bg-transparent text-white' : 'bg-paper text-ink',
        )}
      >
        {/* Top-bar 72px (desktop) / 64px (mobile) */}
        <div className="rule-b mx-auto flex h-16 max-w-[var(--fa-container)] items-center px-6 lg:h-[72px] [--fa-ink:currentColor]">
          <div className="hidden flex-1 items-center lg:flex">
            <a href="https://catwalks.io" target="_blank" rel="noopener noreferrer" className="t-caption inline-flex items-center gap-1">
              Catwalks <ArrowUpRight />
            </a>
          </div>
          <Link href="/" className="wordmark flex-1 text-center lg:flex-none" aria-label="Fashion Atlas — accueil">
            Fashion Atlas
          </Link>
          <div className="flex flex-1 items-center justify-end">
            <button type="button" className="t-caption hidden items-center gap-1 lg:inline-flex" aria-label="Langue">
              FR <ChevronDown />
            </button>
            <button type="button" onClick={() => setMenuOpen(true)} aria-label="Menu" className="grid size-11 place-items-center lg:hidden">
              <Burger />
            </button>
          </div>
        </div>

        {/* Nav 42px (desktop only) */}
        <nav className="rule-b mx-auto hidden h-[42px] max-w-[var(--fa-container)] items-center justify-center gap-11 px-6 lg:flex [--fa-ink:currentColor]" aria-label="Navigation principale">
          {NAV.map((item) => {
            const base =
              't-caption relative inline-flex h-[42px] items-center gap-1 after:absolute after:bottom-0 after:left-0 after:h-px after:w-full after:bg-current after:transition-opacity';
            if (item.external) {
              return (
                <a
                  key={item.href}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(base, 'after:opacity-0 hover:after:opacity-50')}
                >
                  {item.label} <ArrowUpRight />
                </a>
              );
            }
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(base, active ? 'after:opacity-100' : 'after:opacity-0 hover:after:opacity-50')}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Mobile full-screen menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-[120] bg-paper lg:hidden">
          <div className="mx-auto flex h-16 max-w-[var(--fa-container)] items-center justify-between px-6">
            <span className="wordmark text-ink">Fashion Atlas</span>
            <button type="button" onClick={() => setMenuOpen(false)} aria-label="Fermer" className="grid size-11 place-items-center text-ink"><Close /></button>
          </div>
          <ul className="px-6">
            {NAV.map((item) =>
              item.external ? (
                <li key={item.href} className="rule-b">
                  <a href={item.href} target="_blank" rel="noopener noreferrer" className="t-d2 flex items-center gap-1.5 py-5 text-ink">
                    {item.label} <ArrowUpRight />
                  </a>
                </li>
              ) : (
                <li key={item.href} className="rule-b">
                  <Link href={item.href} className="t-d2 block py-5 text-ink">{item.label}</Link>
                </li>
              ),
            )}
          </ul>
          <div className="mt-6 px-6">
            <button type="button" className="t-caption text-ink-muted">FR</button>
          </div>
        </div>
      )}
    </>
  );
}
