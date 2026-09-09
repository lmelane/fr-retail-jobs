import { unstable_cache } from 'next/cache';
import { prisma } from '@catwalks/db';
import { DatabaseUnavailableError } from '../jobs';

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
  return async (...args: A) => {
    // Reviewed repairs must invalidate every affected aggregate without a
    // process restart or waiting an hour. No scan over the Job corpus: this is
    // an indexed lookup in the append-only correction ledger.
    let revision: string;
    try {
      const latest = await prisma.dataCorrection.findFirst({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
      revision = latest?.id ?? 'initial';
    } catch (error) { throw new DatabaseUnavailableError(error); }
    return unstable_cache(() => fn(...args), ['intelligence-canonical-postings-v2', revision, name, JSON.stringify(args)], {
      revalidate: INTEL_REVALIDATE_SECONDS,
      tags: ['intelligence'],
    })();
  };
}
