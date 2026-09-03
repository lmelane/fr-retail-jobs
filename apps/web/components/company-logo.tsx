'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Logo d'une Maison (D9, réactivé par la review UX du 2026-09-04) : favicon
 * via DuckDuckGo (`icons.duckduckgo.com/ip3/{domaine}.ico` — gratuit, sans
 * clé, respectueux de la vie privée), domaine deviné depuis le nom, et
 * monogramme en repli (`onError` OU domaine indevinable). Le logo ne casse
 * jamais l'affichage : au pire, la pastille initiale d'origine.
 */

/** "Maison Margiela" -> "maisonmargiela.com" ; les suffixes légaux tombent. */
export function guessDomain(name: string): string | null {
  const cleaned = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(inc|llc|ltd|gmbh|sa|sas|sarl|bv|b\.v|plc|co|corp|group|groupe|holding|maison)\b\.?/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');
  if (cleaned.length < 3) return null;
  return `${cleaned}.com`;
}

export function CompanyLogo({
  name,
  size = 32,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const domain = guessDomain(name);
  const monogram = name.trim().charAt(0).toUpperCase() || '·';

  if (!domain || failed) {
    return (
      <span
        className={cn('logo', className)}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
        aria-hidden
      >
        {monogram}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('logo object-contain', className)}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
