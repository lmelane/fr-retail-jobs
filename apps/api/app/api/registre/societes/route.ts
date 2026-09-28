import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { DatabaseUnavailableError } from '@/lib/jobs';
import { REGISTRE_Q_MAX, REGISTRE_Q_MIN, rechercherSocietes } from '@/lib/registre';

/**
 * D-471 — la recherche du registre, pour le sélecteur « Maison du catalogue » du back-office. Réservée au BACKEND
 * (`CATALOGUE_API_KEY_BACKEND`) : le site n'en a pas l'usage, et sa clé y est refusée.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  const refus = refuserSiCleInvalide(request, requestId, ['backend']);
  if (refus) return refus;
  const entetes = { 'x-request-id': requestId, 'cache-control': 'no-store' };
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < REGISTRE_Q_MIN || q.length > REGISTRE_Q_MAX) {
    return NextResponse.json({ error: `q : ${REGISTRE_Q_MIN} à ${REGISTRE_Q_MAX} caractères.`, requestId }, { status: 400, headers: entetes });
  }
  try {
    return NextResponse.json({ societes: await rechercherSocietes(q) }, { headers: entetes });
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      return NextResponse.json({ error: 'Le registre des sociétés est indisponible.', requestId }, { status: 503, headers: entetes });
    }
    throw error;
  }
}
