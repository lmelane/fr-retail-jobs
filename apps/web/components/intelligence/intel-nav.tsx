'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { intelPaths } from '@/lib/intelligence/paths';

/**
 * Sous-navigation Intelligence, partagée par toutes les pages du lot W1 :
 * filet pointillé, entrées en caption, active en vert. Les pages de détail
 * (pays, villes) rattachent « Géographies » ; métier → « Métiers ».
 */
const ENTRIES: { label: string; href: string; match: (p: string) => boolean }[] = [
  { label: "Vue d'ensemble", href: intelPaths.home, match: (p) => p === intelPaths.home },
  { label: 'Marché', href: intelPaths.market, match: (p) => p.startsWith(intelPaths.market) },
  { label: 'Géographies', href: intelPaths.geographies, match: (p) => p.startsWith(intelPaths.geographies) || p.startsWith('/intelligence/pays') || p.startsWith('/intelligence/villes') },
  { label: 'Métiers', href: intelPaths.functions, match: (p) => p.startsWith(intelPaths.functions) },
  { label: 'Secteurs', href: intelPaths.sectors, match: (p) => p.startsWith(intelPaths.sectors) },
  { label: 'Méthodologie', href: intelPaths.methodology, match: (p) => p.startsWith(intelPaths.methodology) },
];

export function IntelNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav aria-label="Catwalks Intelligence" className="rule-b">
      <div className="intel-nav">
        {ENTRIES.map((e) => {
          const active = e.match(pathname);
          return (
            <Link key={e.href} href={e.href} aria-current={active ? 'page' : undefined} className="t-caption u-line u-line--nav">
              {e.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
