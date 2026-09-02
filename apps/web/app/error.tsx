'use client';

import { useEffect } from 'react';

/**
 * Error boundary for the offers pages.
 *
 * Decision D1: when the database is unavailable the site shows THIS — a clean,
 * honest error state — never invented offers. A jobboard that shows six fake
 * listings during an outage is worse than one that says it is briefly down.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log the cause so an outage is diagnosable — without it, a real DB failure
  // and a stray bad request would look identical in production.
  useEffect(() => {
    console.error('[error-boundary]', error.digest ?? '', error.message);
  }, [error]);

  return (
    <div className="bg-background flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="bg-surface-low shadow-m3-1 max-w-md rounded-[28px] px-8 py-10">
        <h1 className="text-foreground text-xl font-medium">Service momentanément indisponible</h1>
        <p className="text-muted-foreground mt-3 text-sm leading-6 tracking-[0.25px]">
          Les offres ne sont pas accessibles pour l’instant. Réessayez dans un
          instant — aucune offre affichée ici ne serait fiable tant que le
          service n’est pas rétabli.
        </p>
        <button
          type="button"
          onClick={reset}
          className="bg-secondary-container text-on-secondary-container mt-6 h-11 rounded-full px-6 text-sm font-medium transition-colors hover:opacity-90"
        >
          Réessayer
        </button>
      </div>
    </div>
  );
}
