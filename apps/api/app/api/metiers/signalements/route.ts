import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { CORPS_MAX_OCTETS, SignalementInvalideError, enregistrerSignalement, lireSignalement } from '@/lib/signalements-metier';

/**
 * La remise d'un signal « métier manquant » par le BACKEND seul (`CATALOGUE_API_KEY_BACKEND`), plan §3.7, D-475 §31 b.
 * 201 à la première remise, 200 quand le signal était déjà reçu (idempotent) ; 400 pour un corps hors forme, 413 au-delà
 * de 8 Ko. Jamais par la liste publique : elle est lisible par tous et ne porte que des offres.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const refus = refuserSiCleInvalide(request, requestId, ['backend']);
  if (refus) return refus;
  const entetes = { 'x-request-id': requestId, 'cache-control': 'no-store' };
  const annonce = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(annonce) && annonce > CORPS_MAX_OCTETS) {
    return NextResponse.json({ error: 'Corps trop volumineux.', requestId }, { status: 413, headers: entetes });
  }
  let corps: unknown;
  try {
    const texte = await request.text();
    if (Buffer.byteLength(texte, 'utf8') > CORPS_MAX_OCTETS) {
      return NextResponse.json({ error: 'Corps trop volumineux.', requestId }, { status: 413, headers: entetes });
    }
    corps = JSON.parse(texte);
  } catch {
    return NextResponse.json({ error: 'JSON attendu.', requestId }, { status: 400, headers: entetes });
  }
  try {
    const signalement = lireSignalement(corps);
    const { cree } = await enregistrerSignalement(signalement);
    console.info(JSON.stringify({ evenement: 'metier.signalement', requestId, id: signalement.id, cree }));
    return NextResponse.json({ recu: true, id: signalement.id, cree }, { status: cree ? 201 : 200, headers: entetes });
  } catch (error) {
    if (error instanceof SignalementInvalideError) {
      return NextResponse.json({ error: error.message, chemin: error.chemin, requestId }, { status: 400, headers: entetes });
    }
    console.error(JSON.stringify({ evenement: 'metier.signalement', requestId, error: error instanceof Error ? error.message : String(error) }));
    return NextResponse.json({ error: 'Le signal n’a pas pu être enregistré.', requestId }, { status: 503, headers: { ...entetes, 'retry-after': '60' } });
  }
}
