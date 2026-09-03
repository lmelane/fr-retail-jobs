'use client';

import { useEffect } from 'react';

/**
 * Error boundary (design_2.md §4.13, même langage que le 404).
 *
 * Décision D1 : base indisponible → CETTE page d'erreur propre et honnête,
 * jamais d'offres inventées. Un jobboard qui affiche six offres fictives pendant
 * une panne est pire qu'un qui dit être brièvement indisponible.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log la cause : sans ça, une vraie panne DB et une requête invalide se
  // ressembleraient en prod.
  useEffect(() => {
    console.error('[error-boundary]', error.digest ?? '', error.message);
  }, [error]);

  return (
    <main className="page bg-paper">
      <section className="container notfound rule-b" aria-labelledby="error-title">
        <div className="g12 items-center">
          <div className="c6" aria-hidden />
          <div className="c6">
            <h1 className="t-hero" id="error-title">
              Service momentanément indisponible.
            </h1>
            <p className="t-body soft mt-4 max-w-[560px]">
              Les offres ne sont pas accessibles pour l’instant. Réessayez dans un
              instant — aucune offre affichée ici ne serait fiable tant que le
              service n’est pas rétabli.
            </p>
            <div className="mt-6">
              <button type="button" onClick={reset} className="btn btn--green">
                Réessayer
                <svg viewBox="0 0 24 24" aria-hidden width="16" height="16" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
