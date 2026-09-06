import { unstable_cache } from 'next/cache';

/**
 * Cache de données à 1 h (l'ISR du brief, déplacé au niveau des requêtes).
 *
 * Pourquoi pas `export const revalidate = 3600` sur les pages : avec lui Next
 * PRÉ-REND les routes statiques au BUILD, et la build Railway (Dockerfile web)
 * n'a pas de base — le prérendu lèverait DatabaseUnavailableError et casserait
 * la build (le cas est déjà documenté sur le sitemap de ce dépôt). Les pages
 * restent `force-dynamic` ; les agrégats lourds sont mémorisés ici 1 h, par
 * clé de paramètres. Une erreur (base injoignable) n'est jamais mise en cache :
 * elle remonte et la page d'erreur D1 s'affiche.
 *
 * Contrat : la valeur rendue doit être sérialisable en JSON (dates en ISO).
 */
export const INTEL_REVALIDATE_SECONDS = 3600;

export function cached<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) =>
    unstable_cache(() => fn(...args), ['intelligence', name, JSON.stringify(args)], {
      revalidate: INTEL_REVALIDATE_SECONDS,
      tags: ['intelligence'],
    })();
}
