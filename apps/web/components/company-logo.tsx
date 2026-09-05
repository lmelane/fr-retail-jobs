'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { guessDomain } from '@/lib/company-domain';

/**
 * Logo d'une Maison (D9, réactivé par la review UX du 2026-09-04) : favicon
 * via DuckDuckGo (`icons.duckduckgo.com/ip3/{domaine}.ico` — gratuit, sans
 * clé, respectueux de la vie privée), domaine deviné depuis le nom, et
 * monogramme en repli (`onError` OU domaine indevinable). Le logo ne casse
 * jamais l'affichage : au pire, la pastille initiale d'origine.
 */

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
      // Passe par notre route plutôt que par le fournisseur en direct : elle
      // seule voit le statut HTTP et peut refuser le placeholder « domaine
      // inconnu », que le navigateur afficherait sans déclencher onError.
      src={`/api/logo?domain=${encodeURIComponent(domain)}`}
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
