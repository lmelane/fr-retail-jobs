import { SearchQueryError } from '@/lib/search-intent';
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { DatabaseUnavailableError, getJobs, parseFilters } from '@/lib/jobs';
import { projeterListe } from '@/lib/projection';
import { PerimetreRequisError } from '@/lib/perimetre';
import { CurseurInvalideError } from '@/lib/curseur';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { paramsMultiples } from '@/lib/params-multiples';

/**
 * LA RECHERCHE, servie à catwalks.io (D-417, lot 6).
 *
 * Une seule projection — la liste, sans description (173 Ko par page mesurés
 * le 14/09/2026 avant de la retirer) — et un seul contrat d'URL, lu par
 * `parseFilters` pour toutes les pages : la page 1 rendue par le site et les
 * pages suivantes du chargement continu ne peuvent pas diverger.
 *
 * Le périmètre est OBLIGATOIRE : sans `marche` valide, la réponse est un 400
 * qui nomme le motif et les marchés ouverts — jamais une liste mondiale. Un
 * filtre que le marché ne sert pas n'est ni honoré ni ignoré : il est nommé
 * dans `filtresRefuses`, et les résultats sont calculés sans lui.
 *
 * `x-request-id` : repris de l'appelant s'il le fournit (catwalks.io le
 * génère), sinon créé ici ; renvoyé en en-tête, présent dans la ligne de
 * journal et dans le corps des erreurs techniques.
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
  const refus = refuserSiCleInvalide(request, requestId);
  if (refus) return refus;
  const debut = Date.now();
  const entetes = { 'x-request-id': requestId };
  // D-426 : PAS `Object.fromEntries` — il ne garde qu'une valeur par clé et
  // annulerait le multi-valeurs avant même d'atteindre le parseur.
  const filters = parseFilters(paramsMultiples(request.nextUrl.searchParams));

  try {
    const result = await getJobs(filters);
    journaliser({ requestId, statut: 200, dureeMs: Date.now() - debut, marche: result.perimetre.code, total: result.total,
      totalConfirmes: result.totalConfirmes, suite: result.suivant !== null, resultats: result.jobs.length, refus: result.filtresRefuses.length });
    return NextResponse.json(projeterListe(result), { headers: entetes });
  } catch (error) {
    if (error instanceof PerimetreRequisError || error instanceof CurseurInvalideError || error instanceof SearchQueryError) {
      journaliser({ requestId, statut: 400, dureeMs: Date.now() - debut, erreur: error.code });
      return NextResponse.json(error.corps(requestId), { status: 400, headers: entetes });
    }
    // Same contract as the page: a database outage is a 503 with a clear
    // message, never a silently empty list passed off as "no results".
    if (error instanceof DatabaseUnavailableError) {
      journaliser({ requestId, statut: 503, dureeMs: Date.now() - debut, erreur: 'base indisponible' });
      return NextResponse.json(
        { error: 'La base de données des offres est indisponible.', requestId },
        { status: 503, headers: entetes },
      );
    }
    journaliser({ requestId, statut: 500, dureeMs: Date.now() - debut, erreur: error instanceof Error ? error.name : 'inconnue' });
    throw error;
  }
}
