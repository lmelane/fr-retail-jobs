import { NextRequest, NextResponse } from 'next/server';
import { suggestCities, suggestCompanies, suggestOccupations, suggestTitlesDetaillees } from '@/lib/suggestions';
import { PerimetreRequisError, exigerPerimetre } from '@/lib/perimetre';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { SearchQueryError } from '@/lib/search-intent';
import { randomUUID } from 'node:crypto';

/**
 * Search-bar autocomplete, from our own data and INSIDE THE PERIMETER (lot 6):
 * cities, job titles and Maison names the board actually holds in the market,
 * so a suggestion always leads somewhere real for that candidate.
 * `?type=city|title|company|metier&q=<prefix>&marche=XX[&locale=xx]` returns up to 8 strings in `suggestions`.
 * D-475 (plan §3.5), contrat ADDITIF : pour `title`, `metiers[i]` porte le métier que nomme `suggestions[i]`
 * (`{ identifiant, libelle }` ou `null`) ; `type=metier` rend les métiers de la taxonomie, même sans offre vivante.
 *
 * Le périmètre est obligatoire ici comme sur `/api/jobs` : sans lui, un 400,
 * jamais une liste mondiale. Une fois le périmètre acquis, l'endpoint reste
 * silencieux : sur toute panne il rend une liste vide plutôt qu'une erreur —
 * une autocomplétion cassée ne doit jamais casser la barre de recherche.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  const refus = refuserSiCleInvalide(request, requestId);
  if (refus) return refus;
  const type = request.nextUrl.searchParams.get('type');
  const q = request.nextUrl.searchParams.get('q') ?? '';
  let perimetre;
  try {
    perimetre = exigerPerimetre(request.nextUrl.searchParams.get('marche') ?? request.nextUrl.searchParams.get('market') ?? undefined);
  } catch (error) {
    if (error instanceof PerimetreRequisError) return NextResponse.json(error.corps(requestId), { status: 400 });
    throw error;
  }

  try {
    const locale = request.nextUrl.searchParams.get('locale') ?? undefined;
    if (type === 'city') return NextResponse.json({ suggestions: await suggestCities(q, perimetre) });
    if (type === 'company') return NextResponse.json({ suggestions: await suggestCompanies(q, perimetre) });
    if (type === 'metier') {
      const metiers = await suggestOccupations(q, perimetre, locale);
      return NextResponse.json({ suggestions: metiers.map((m) => m.libelle), metiers });
    }
    const details = await suggestTitlesDetaillees(q, perimetre, locale);
    return NextResponse.json({ suggestions: details.map((d) => d.valeur), metiers: details.map((d) => d.metier) });
  } catch (error) {
    if (error instanceof SearchQueryError) return NextResponse.json(error.corps(requestId), {status:400});
    return NextResponse.json({ suggestions: [], code: 'SEARCH_UNAVAILABLE', requestId }, {status:503});
  }
}
