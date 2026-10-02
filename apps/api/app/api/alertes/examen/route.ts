import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { CurseurInvalideError } from '@/lib/curseur';
import { DatabaseUnavailableError, examinerAlerte, parseFilters } from '@/lib/jobs';
import { PerimetreRequisError } from '@/lib/perimetre';
import { paramsMultiples } from '@/lib/params-multiples';
import { projeterLignes } from '@/lib/projection';
import { SearchQueryError } from '@/lib/search-intent';
import { lireBornesExamen } from '@/lib/examen-alerte';
import { offerPath } from '@/lib/offer-url';
import { annonceComprehension, annonceFraicheur, annonceNonPrecisees, annonceProximite } from '@/lib/contrat-client';

/**
 * L'EXAMEN D'UNE ALERTE, pour le moteur d'alertes du BACKEND (R-130 §3, §10 ; D-464 §1, §3).
 *
 * Réservé à la clé du backend (`CATALOGUE_API_KEY_BACKEND`), révocable seule : la clé du site y est refusée. On reçoit
 * des critères de recherche et deux bornes de date, jamais une personne (D-423).
 *
 * Mêmes paramètres que `/api/jobs` (le contrat de `/emplois`), plus `entreeApres` et `publieeApres` (ISO 8601).
 * Réponse : `total` (toute la recherche, comme le nombre affiché sur `/emplois`), `nouvelles` (entrées après le
 * filigrane et publiées après la borne, ou sans date), et les 50 premières nouvelles dans l'ordre de `/emplois`, chacune
 * avec le `chemin` de sa fiche sur le site.
 *
 * D-515 §2 (additif) : pour une alerte qui correspond fortement (métier ou lieu posés), `incompletes` et
 * `jobsIncompletes`, les nouvelles qui respectent avec certitude tous les autres critères mais ne précisent pas le contrat,
 * le temps de travail, le secteur, la langue ou le programme filtrés ; chacune avec `dimensions`. Sans métier ni lieu,
 * aucune (lecture D-492 du 02/10/2026). Elles ne sont
 * JAMAIS dans `jobs` : un backend d'avant, qui ne lit pas ces champs, n'envoie que les certaines, comme avant.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const brut = request.headers.get('x-request-id')?.trim() ?? '';
  const requestId = /^[A-Za-z0-9._-]{8,128}$/.test(brut) ? brut : randomUUID();
  const refus = refuserSiCleInvalide(request, requestId, ['backend']);
  if (refus) return refus;
  const entetes = { 'x-request-id': requestId, 'cache-control': 'no-store' };
  const debut = Date.now();

  const bornes = lireBornesExamen(request.nextUrl.searchParams);
  if (!bornes.ok) return NextResponse.json({ error: bornes.erreur, requestId }, { status: 400, headers: entetes });
  // D-496 : la proximité au seul appelant qui l'annonce (le backend qui enregistre des lieux « Paris (75) ») ; sans lui,
  // l'examen d'avant.
  // D-500 : une alerte rejoue exactement la recherche de la page (R-128 §2), donc la même requête comprise.
  // D-510 : et le même ordre, par fraîcheur.
  const filtres = { ...parseFilters(paramsMultiples(request.nextUrl.searchParams)), proximite: annonceProximite(request.headers),
    comprendre: annonceComprehension(request.headers), fraicheur: annonceFraicheur(request.headers),
    // D-513, D-515 §2 : le cercle est celui de la page, choisi sur les offres reconnues ; les offres qui respectent
    // RÉELLEMENT chaque critère sont dans `jobs` ; si l'alerte est forte, celles qui ne précisent pas le contrat, le temps
    // de travail, le secteur, la langue ou le programme filtrés à part (`jobsIncompletes`) : jamais un « contrat non
    // précisé » présenté comme un CDI.
    nonPrecisees: annonceNonPrecisees(request.headers) };

  try {
    const examen = await examinerAlerte(filtres, bornes.entreeApres, bornes.publieeApres);
    console.info(JSON.stringify({ evenement: 'api.alertes.examen', requestId, statut: 200, dureeMs: Date.now() - debut,
      marche: examen.perimetre.code, total: examen.total, nouvelles: examen.nouvelles, incompletes: examen.incompletes, refus: examen.filtresRefuses.length }));
    return NextResponse.json({
      total: examen.total,
      nouvelles: examen.nouvelles,
      filtresRefuses: examen.filtresRefuses,
      // Le chemin de la fiche, calculé ICI par l'algorithme unique (`offerPath`) : le backend le colle derrière l'hôte
      // du site sans jamais recopier la règle du slug.
      jobs: projeterLignes(examen.jobs, examen.perimetre.langueDesLibelles).map((j) => ({ ...j, chemin: offerPath(j) })),
      // D-515 §2, au seul client qui l'annonce (contrat 2) : sans lui, le document d'avant, à l'identique.
      ...(filtres.nonPrecisees ? {
        incompletes: examen.incompletes ?? 0,
        jobsIncompletes: projeterLignes(examen.jobsIncompletes ?? [], examen.perimetre.langueDesLibelles).map((j) => ({
          ...j, chemin: offerPath(j), dimensions: j.correspondance?.statut === 'NON_CONFIRMEE' ? j.correspondance.dimensions : [] })),
      } : {}),
    }, { headers: entetes });
  } catch (error) {
    if (error instanceof PerimetreRequisError || error instanceof CurseurInvalideError || error instanceof SearchQueryError) {
      return NextResponse.json(error.corps(requestId), { status: 400, headers: entetes });
    }
    if (error instanceof DatabaseUnavailableError) {
      console.warn(JSON.stringify({ evenement: 'api.alertes.examen', requestId, statut: 503, dureeMs: Date.now() - debut }));
      return NextResponse.json({ error: 'La base de données des offres est indisponible.', requestId }, { status: 503, headers: entetes });
    }
    throw error;
  }
}
