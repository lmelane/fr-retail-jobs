import { NextResponse, type NextRequest } from 'next/server';

/**
 * Le garde d'accès de l'API du catalogue (D-422).
 *
 * L'appelant légitime est UNIQUE et c'est un serveur : le rendu de
 * catwalks.io sur Vercel. Pas de comptes, pas de portail : une clé partagée,
 * portée par `Authorization: Bearer …`, comparée à `CATALOGUE_API_KEY`.
 *
 * Mesuré avant d'écrire ce fichier (14/09/2026) : sans garde, 3 338 requêtes
 * suffisaient à aspirer les 83 431 offres du catalogue (~166 Mo). L'absence
 * d'en-têtes CORS protégeait du navigateur tiers, jamais du script.
 *
 * `/api/health` n'est PAS gardée (D-422 §3) : Railway l'interroge pour savoir
 * si le service est vivant, et une santé protégée ferait redéployer en boucle.
 */

/** Comparaison à temps constant : une comparaison naïve fuit la clé caractère par caractère. */
function egalesEnTempsConstant(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** La clé attendue, ou null si le service n'en exige aucune. */
export function cleAttendue(): string | null {
  const brut = process.env.CATALOGUE_API_KEY?.trim();
  return brut ? brut : null;
}

/**
 * `null` = l'appel est autorisé, la route continue.
 * Une `NextResponse` = l'appel est refusé, la route la renvoie telle quelle.
 *
 * Sans `CATALOGUE_API_KEY` configurée, le garde LAISSE PASSER : c'est
 * délibéré. Le jour où la variable manque en production, l'API continue de
 * servir catwalks.io plutôt que de tomber d'un coup ; l'absence se voit dans
 * le journal, pas dans une panne. Poser la variable est l'acte qui arme le
 * garde.
 */
export function refuserSiCleInvalide(request: NextRequest, requestId: string): NextResponse | null {
  const attendue = cleAttendue();
  if (!attendue) {
    console.info(JSON.stringify({ evenement: 'api.cle', requestId, etat: 'desarme', detail: 'CATALOGUE_API_KEY absente' }));
    return null;
  }
  const entete = request.headers.get('authorization')?.trim() ?? '';
  const fournie = /^Bearer\s+(.+)$/i.exec(entete)?.[1]?.trim() ?? '';
  if (fournie && egalesEnTempsConstant(fournie, attendue)) return null;

  console.info(JSON.stringify({
    evenement: 'api.cle',
    requestId,
    etat: 'refus',
    // Jamais la clé, ni celle attendue ni celle fournie : seulement le motif.
    motif: fournie ? 'cle invalide' : 'aucune cle',
  }));
  return NextResponse.json(
    { error: 'Clé d’accès requise.', requestId },
    { status: 401, headers: { 'x-request-id': requestId, 'www-authenticate': 'Bearer' } },
  );
}
