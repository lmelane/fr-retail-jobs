import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { DatabaseUnavailableError, getJobs, parseFilters } from '@/lib/jobs';
import { projeterListe } from '@/lib/projection';

/**
 * Page 2+ of the offer list, for infinite scroll — et, depuis F1 (D-417),
 * la recherche que consomme catwalks.io côté serveur.
 *
 * Page 1 is server-rendered by app/page.tsx (SEO, first paint); this route
 * exists only so the candidate scrolling down never triggers a full page
 * reload. It reads the SAME URL keys as the server render — via the shared
 * parseFilters — so a search filtered by ville/secteur/contrat… continues
 * identically past page 1 instead of silently resetting.
 *
 * F1, phase 1 et 2 :
 *  - `champs=liste` rend la projection sans description, avec les libellés
 *    d'affichage (`lib/projection.ts`) ;
 *  - `x-request-id` : repris de l'appelant s'il le fournit (catwalks.io le
 *    génère), sinon créé ici ; renvoyé en en-tête, présent dans la ligne de
 *    journal et dans le corps des erreurs techniques.
 */
export const dynamic = 'force-dynamic';

/** Un identifiant d'appelant est repris tel quel s'il est sobre ; sinon remplacé. */
function requestIdDepuis(request: NextRequest): string {
  const brut = request.headers.get('x-request-id')?.trim() ?? '';
  return /^[A-Za-z0-9._-]{8,128}$/.test(brut) ? brut : randomUUID();
}

function journaliser(ligne: Record<string, unknown>): void {
  console.info(JSON.stringify({ evenement: 'api.jobs', ...ligne }));
}

export async function GET(request: NextRequest) {
  const requestId = requestIdDepuis(request);
  const debut = Date.now();
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const filters = parseFilters(params);
  const liste = request.nextUrl.searchParams.get('champs') === 'liste';

  try {
    const result = await getJobs(filters);
    // Le lieu tel que le moteur l'a compris (audit UX H3) : le front l'affiche
    // à la place de la saisie brute.
    const corps = liste ? { ...projeterListe(result), lieu: filters.lieuResolu ?? null } : result;
    journaliser({ requestId, statut: 200, dureeMs: Date.now() - debut, total: result.total, page: result.page, resultats: result.jobs.length, liste });
    return NextResponse.json(corps, { headers: { 'x-request-id': requestId } });
  } catch (error) {
    // Same contract as the page: a database outage is a 503 with a clear
    // message, never a silently empty list passed off as "no results".
    if (error instanceof DatabaseUnavailableError) {
      journaliser({ requestId, statut: 503, dureeMs: Date.now() - debut, erreur: 'base indisponible' });
      return NextResponse.json(
        { error: 'La base de données des offres est indisponible.', requestId },
        { status: 503, headers: { 'x-request-id': requestId } },
      );
    }
    journaliser({ requestId, statut: 500, dureeMs: Date.now() - debut, erreur: error instanceof Error ? error.name : 'inconnue' });
    throw error;
  }
}
