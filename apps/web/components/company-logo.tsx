'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Logo d'une Maison (D9) : le favicon de SON domaine, via `/api/logo`, ou le
 * monogramme.
 *
 * Le domaine vient de la base (`Company.domain`), posé à l'ingest depuis le
 * domaine carrière du catalogue ou par `resolve-domains` (Wikidata P856) —
 * jamais deviné depuis le nom. Loïc, 2026-09-06 : « les pictogrammes des
 * entreprises ne correspondent pas aux entreprises » — un nom devinait souvent
 * le domaine réel d'une AUTRE entreprise (mac.com, omega.com), et aucun
 * `onError` ne peut détecter « mauvaise entreprise ». Sans domaine connu, le
 * monogramme : il dit moins, mais il ne ment pas.
 */

export function CompanyLogo({
  name,
  domain,
  size = 32,
  className,
}: {
  name: string;
  /** `Company.domain` — null/undefined quand aucune source ne le nomme. */
  domain?: string | null;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
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
