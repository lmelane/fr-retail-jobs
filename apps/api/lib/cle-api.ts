import { createHash, timingSafeEqual } from 'node:crypto';
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

/**
 * Comparaison à temps constant : une comparaison naïve fuit la clé caractère
 * par caractère.
 *
 * Audit du 14/09/2026 : la version précédente sortait immédiatement quand les
 * longueurs différaient, ce qui fuitait la LONGUEUR de la clé. Mesuré comme
 * non exploitable ici (écarts de 0,1 à 0,3 ms, noyés dans la gigue réseau),
 * mais un défaut se corrige quand il est connu, il ne se plaide pas.
 *
 * `timingSafeEqual` de Node exige des tampons de même taille : on hache les
 * deux valeurs d'abord. Deux empreintes font toujours 32 octets, quelle que
 * soit la longueur des clés — la comparaison ne révèle donc plus rien, ni le
 * contenu ni la taille.
 */
function egalesEnTempsConstant(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
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
 * Sans `CATALOGUE_API_KEY` configurée, le garde FERME en production (503,
 * « non configuré ») : jusqu'au lot 12 il laissait passer pour que le site
 * survive à une variable oubliée, ce qui faisait d'un oubli de déploiement une
 * API publique ouverte à tout script (passation §11.1 : « chemin
 * potentiellement ouvert », à corriger avant release). Hors production
 * (`next dev`, témoins), l'absence de clé reste tolérée et journalisée pour
 * que le poste local fonctionne sans secret. Poser la variable est l'acte qui
 * arme le garde ; en production, l'oublier se voit en 503, jamais en fuite.
 */
export function refuserSiCleInvalide(request: NextRequest, requestId: string): NextResponse | null {
  const attendue = cleAttendue();
  if (!attendue) {
    if (process.env.NODE_ENV === 'production') {
      console.error(JSON.stringify({ evenement: 'api.cle', requestId, etat: 'non_configure', detail: 'CATALOGUE_API_KEY absente en production' }));
      return NextResponse.json(
        { error: 'Clé d’accès du catalogue non configurée.', requestId },
        { status: 503, headers: { 'x-request-id': requestId, 'retry-after': '60' } },
      );
    }
    console.info(JSON.stringify({ evenement: 'api.cle', requestId, etat: 'desarme', detail: 'CATALOGUE_API_KEY absente hors production' }));
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
