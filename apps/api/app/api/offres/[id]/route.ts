import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import {
  DatabaseUnavailableError,
  getCompanyAside,
  getSimilarJobs,
  resolveOfferParam,
} from '@/lib/jobs';
import { offerPath } from '@/lib/offer-url';
import { projeterFiche, projeterLignes } from '@/lib/projection';
import { refuserSiCleInvalide } from '@/lib/cle-api';

/**
 * F1 phase 1 — LA fiche d'une offre en JSON, pour catwalks.io.
 *
 * Jusqu'ici la fiche n'existait qu'en HTML (`/offre/[id]`) : le statut, la
 * canonicalisation `slug-id`, les similaires et le bloc Maison étaient
 * calculés au rendu. Cette route expose les MÊMES fonctions, sans les
 * recopier : `resolveOfferParam` (id nu ou slug-id, redirections de fusion),
 * `getSimilarJobs`, `getCompanyAside`.
 *
 * Statuts : `active` 200 · `closed` 410 (le corps porte l'offre, comme la
 * page : le front affiche un bandeau) · `missing` 404 · base 503.
 * `x-request-id` : repris de l'appelant, renvoyé en en-tête, journalisé.
 */
export const dynamic = 'force-dynamic';

function requestIdDepuis(request: NextRequest): string {
  const brut = request.headers.get('x-request-id')?.trim() ?? '';
  return /^[A-Za-z0-9._-]{8,128}$/.test(brut) ? brut : randomUUID();
}

function journaliser(ligne: Record<string, unknown>): void {
  console.info(JSON.stringify({ evenement: 'api.offre', ...ligne }));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = requestIdDepuis(request);
  const refus = refuserSiCleInvalide(request, requestId);
  if (refus) return refus;
  const debut = Date.now();
  const { id } = await params;
  const entetes = { 'x-request-id': requestId };

  try {
    const resolu = await resolveOfferParam(id.slice(0, 200));
    if (resolu.status === 'missing') {
      journaliser({ requestId, statut: 404, dureeMs: Date.now() - debut });
      return NextResponse.json({ status: 'missing', requestId }, { status: 404, headers: entetes });
    }
    // Audit UX 14/09 (H1) : les similaires servent SURTOUT sur une offre
    // fermée, c'est la seule issue du candidat ; calculées quel que soit le statut.
    const [similaires, maison] = await Promise.all([getSimilarJobs(resolu.job, 6), getCompanyAside(resolu.job.company)]);
    const corps = {
      status: resolu.status,
      /** Chemin canonique de la source (`/offre/slug-id`) ; le front en dérive le sien. */
      canonicalId: resolu.job.id,
      canonicalSlugPath: offerPath(resolu.job),
      job: projeterFiche(resolu.job),
      similaires: projeterLignes(similaires),
      maison,
    };
    const statut = resolu.status === 'closed' ? 410 : 200;
    journaliser({ requestId, statut, dureeMs: Date.now() - debut, similaires: similaires.length });
    return NextResponse.json(corps, { status: statut, headers: entetes });
  } catch (error) {
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
