import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import {
  DatabaseUnavailableError,
  getCompanyAside,
  getSimilarJobs,
  langueDesLibellesDuPays,
  resolveOfferParam,
} from '@/lib/jobs';
import { offerPath } from '@/lib/offer-url';
import { projeterFiche, projeterLignes } from '@/lib/projection';
import { refuserSiCleInvalide } from '@/lib/cle-api';

/** Qualified publication detail; withdrawn IDs can have no public content.
 * Active: 200. Closed or withdrawn: 410. Missing: 404. Database failure: 503.
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
    if (resolu.status === 'withdrawn' && !resolu.job) {
      journaliser({ requestId, statut: 410, dureeMs: Date.now() - debut });
      return NextResponse.json({ status: 'withdrawn', canonicalId: resolu.canonicalId,
        canonicalSlugPath: null, job: null, similaires: [], maison: null }, { status: 410, headers: entetes });
    }
    // Audit UX 14/09 (H1) : les similaires servent SURTOUT sur une offre
    // fermée, c'est la seule issue du candidat ; calculées quel que soit le statut.
    const job = resolu.job!;
    const [similaires, maison] = await Promise.all([getSimilarJobs(job, 6), getCompanyAside(job.company)]);
    // Lot 8 : une offre lue seule est libellée dans la langue du marché de son pays.
    const langue = langueDesLibellesDuPays(job.countryCode);
    const corps = {
      status: resolu.status,
      /** Chemin canonique de la source (`/offre/slug-id`) ; le front en dérive le sien. */
      canonicalId: job.id,
      canonicalSlugPath: offerPath(job),
      job: projeterFiche(job, langue),
      similaires: projeterLignes(similaires, langue),
      maison,
      langueDesLibelles: langue,
    };
    const statut = resolu.status === 'active' ? 200 : 410;
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
