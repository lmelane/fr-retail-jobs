import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { refuserSiCleInvalide } from '@/lib/cle-api';
import { annonceComprehension } from '@/lib/contrat-client';
import { PerimetreRequisError, exigerPerimetre } from '@/lib/perimetre';
import { enregistrerRequete } from '@/lib/requetes-tapees';

/**
 * D-501 §2 — UNE REQUÊTE TAPÉE, REMISE PAR LE SITE au lancement d'une recherche tapée dans la barre (`POST`, corps JSON
 * `{ marche, q }`, clé du site, contrat 2). Rien d'autre n'est lu ni gardé : ni compte, ni appareil, ni adresse IP, ni
 * heure (`requetes-tapees.ts`). La réponse ne dit jamais si la requête a été comptée au-delà de `enregistree`.
 *
 * Le site ne l'appelle qu'avec `REQUETES_TAPEES_ACTIF=1`, posée après la validation juridique (D-501, garde) : tant
 * qu'elle ne l'est pas, cette route ne reçoit rien.
 */
export const dynamic = 'force-dynamic';
const CORPS_MAX = 2_000;

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const refus = refuserSiCleInvalide(request, requestId);
  if (refus) return refus;
  const entetes = { 'cache-control': 'no-store' };
  if (!annonceComprehension(request.headers)) return NextResponse.json({ enregistree: false }, { status: 202, headers: entetes });
  let corps: unknown;
  try {
    const texte = await request.text();
    if (texte.length > CORPS_MAX) return NextResponse.json({ error: 'CORPS_TROP_LONG', requestId }, { status: 413, headers: entetes });
    corps = JSON.parse(texte);
  } catch {
    return NextResponse.json({ error: 'CORPS_INVALIDE', requestId }, { status: 400, headers: entetes });
  }
  const { marche, q } = (corps && typeof corps === 'object' ? corps : {}) as Record<string, unknown>;
  if (typeof marche !== 'string' || typeof q !== 'string') return NextResponse.json({ error: 'CORPS_INVALIDE', requestId }, { status: 400, headers: entetes });
  let code: string;
  try {
    code = exigerPerimetre(marche).code;
  } catch (error) {
    if (error instanceof PerimetreRequisError) return NextResponse.json(error.corps(requestId), { status: 400, headers: entetes });
    throw error;
  }
  try {
    return NextResponse.json({ enregistree: await enregistrerRequete(code, q) }, { status: 202, headers: entetes });
  } catch {
    // Compter une requête n'est jamais une raison de faire échouer une recherche : la panne se dit, sans détail.
    return NextResponse.json({ enregistree: false, requestId }, { status: 503, headers: entetes });
  }
}
