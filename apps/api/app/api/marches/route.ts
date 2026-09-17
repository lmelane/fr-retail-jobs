import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { contratMarchesCached } from '@/lib/marches-catalogue';
import { DatabaseUnavailableError } from '@/lib/jobs';
import { refuserSiCleInvalide } from '@/lib/cle-api';

/**
 * `GET /api/marches` — le contrat des marchés et le compteur du catalogue
 * (lot 6). Seule source du sélecteur de marché, des périmètres, des facettes
 * et des libellés côté site ; protégé par la même clé que les autres routes
 * (D-422). Une base indisponible rend 503 : le site n'invente ni marché ni
 * compteur.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requestId = randomUUID();
  const refus = refuserSiCleInvalide(request, requestId);
  if (refus) return refus;
  try {
    return NextResponse.json(await contratMarchesCached(), { headers: { 'x-request-id': requestId } });
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) {
      return NextResponse.json({ error: 'Le catalogue est indisponible.', requestId }, { status: 503, headers: { 'x-request-id': requestId, 'cache-control': 'no-store' } });
    }
    throw error;
  }
}
