import { NextRequest, NextResponse } from 'next/server';
import { suggestCities, suggestCompanies, suggestLieux, suggestLieuxDeTete, suggestOccupations, suggestTitlesDetaillees } from '@/lib/suggestions';
import { suggestTitlesCanoniques } from '@/lib/suggestions-canoniques';
import { annonceComprehension, annonceProximite } from '@/lib/contrat-client';
import { PerimetreRequisError, exigerPerimetre } from '@/lib/perimetre';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { SearchQueryError } from '@/lib/search-intent';
import { randomUUID } from 'node:crypto';

/**
 * Search-bar autocomplete, from our own data and INSIDE THE PERIMETER (lot 6):
 * cities, job titles and Maison names the board actually holds in the market,
 * so a suggestion always leads somewhere real for that candidate.
 * `?type=city|title|company|metier&q=<prefix>&marche=XX[&locale=xx]` returns up to 8 strings in `suggestions`.
 * D-500 (contrat 2, `x-catwalks-client: 2`) : `title` rend les suggestions canoniques et `natures[i]`
 * (« metier », « intitule », « populaire ») ; `city` avec `q` vide rend les lieux de tête de la base de lieux.
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
    // D-496, D-499 : les lieux reconnus (« Paris (75) ») au seul client qui annonce le contrat de proximité.
    if (type === 'city') {
      // D-500 (Q2) : au focus d'un champ vide, les lieux de tête de la base de lieux (« Paris (75) »), au même client.
      if (annonceProximite(request.headers) && !q.trim()) return NextResponse.json({ suggestions: await suggestLieuxDeTete(perimetre, locale) });
      return NextResponse.json({ suggestions: annonceProximite(request.headers) ? await suggestLieux(q, perimetre, locale) : await suggestCities(q, perimetre) });
    }
    if (type === 'company') return NextResponse.json({ suggestions: await suggestCompanies(q, perimetre) });
    if (type === 'metier') {
      const metiers = await suggestOccupations(q, perimetre, locale);
      return NextResponse.json({ suggestions: metiers.map((m) => m.libelle), metiers });
    }
    // D-500 (Q2) : au client du contrat 2, les suggestions canoniques (une ligne par métier, puis des intitulés nettoyés,
    // puis les requêtes populaires) et leur nature (`natures[i]`, additif) ; sans lui, le contrat d'avant, à l'identique.
    if (annonceComprehension(request.headers)) {
      const canoniques = await suggestTitlesCanoniques(q, perimetre, locale);
      return NextResponse.json({ suggestions: canoniques.map((d) => d.valeur), metiers: canoniques.map((d) => d.metier),
        natures: canoniques.map((d) => d.nature) });
    }
    const details = await suggestTitlesDetaillees(q, perimetre, locale);
    return NextResponse.json({ suggestions: details.map((d) => d.valeur), metiers: details.map((d) => d.metier) });
  } catch (error) {
    if (error instanceof SearchQueryError) return NextResponse.json(error.corps(requestId), {status:400});
    return NextResponse.json({ suggestions: [], code: 'SEARCH_UNAVAILABLE', requestId }, {status:503});
  }
}
