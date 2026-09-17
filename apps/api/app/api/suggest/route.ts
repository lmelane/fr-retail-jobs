import { NextRequest, NextResponse } from 'next/server';
import { suggestCities, suggestCompanies, suggestTitles } from '@/lib/suggestions';
import { PerimetreRequisError, exigerPerimetre } from '@/lib/perimetre';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { randomUUID } from 'node:crypto';

/**
 * Search-bar autocomplete, from our own data and INSIDE THE PERIMETER (lot 6):
 * cities, job titles and Maison names the board actually holds in the market,
 * so a suggestion always leads somewhere real for that candidate.
 * `?type=city|title|company&q=<prefix>&marche=XX` returns up to 8 strings.
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
    const suggestions =
      type === 'city'
        ? await suggestCities(q, perimetre)
        : type === 'company'
          ? await suggestCompanies(q, perimetre)
          : await suggestTitles(q, perimetre);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
