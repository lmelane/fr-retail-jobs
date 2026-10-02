import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Le garde d'accès de l'API du catalogue (D-422).
 *
 * Les appelants légitimes sont des SERVEURS, chacun avec sa clé : le rendu de
 * catwalks.io sur Vercel (`CATALOGUE_API_KEY`, toutes les routes publiques) et,
 * depuis D-471, le backend (`CATALOGUE_API_KEY_BACKEND`, quatre routes seulement,
 * voir plus bas). Pas de comptes, pas de portail : une clé par appelant, portée
 * par `Authorization: Bearer …`.
 *
 * Mesuré avant d'écrire ce fichier (14/09/2026) : sans garde, 3 338 requêtes
 * suffisaient à aspirer les 83 431 offres du catalogue (~166 Mo). L'absence
 * d'en-têtes CORS protégeait du navigateur tiers, jamais du script.
 *
 * `/api/health` n'est PAS gardée (D-422 §3) : Railway l'interroge pour savoir
 * si le service est vivant, et une santé protégée ferait redéployer en boucle.
 *
 * D-464 §3 / D-471 — UN SECOND APPELANT, LE BACKEND, AVEC SA PROPRE CLÉ
 * (`CATALOGUE_API_KEY_BACKEND`), révocable seule. Il ne reçoit que les routes
 * dont il a besoin : la fiche d'une offre (les démarches, R-133), la
 * recherche du registre (le sélecteur du back-office) et, depuis le lot 2E de
 * D-475, l'export de la taxonomie des métiers et la remise des signaux
 * « métier manquant » (ces deux-là au backend seul), l'examen d'une alerte
 * (R-130) et, depuis la lecture D-492 sous D-496 (02/10/2026), les seules
 * suggestions de LIEU de `/api/suggest` (`type=city`, la forme reconnue
 * « Paris (75) » d'un nom nu). Une route qui ne le nomme pas reste réservée au
 * site : par défaut, `appelants = ['site']`.
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

export type Appelant = 'site' | 'backend';
const VARIABLE_DE_CLE: Record<Appelant, string> = { site: 'CATALOGUE_API_KEY', backend: 'CATALOGUE_API_KEY_BACKEND' };

/** La clé attendue d'un appelant, ou null si elle n'est pas configurée. */
export function cleAttendue(appelant: Appelant = 'site'): string | null {
  const brut = process.env[VARIABLE_DE_CLE[appelant]]?.trim();
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
export function refuserSiCleInvalide(request: NextRequest, requestId: string,
  appelants: readonly Appelant[] = ['site']): NextResponse | null {
  const attendues = appelants.map((a) => cleAttendue(a)).filter((c): c is string => c !== null);
  if (!attendues.length) {
    if (process.env.NODE_ENV === 'production') {
      console.error(JSON.stringify({ evenement: 'api.cle', requestId, etat: 'non_configure',
        detail: `${appelants.map((a) => VARIABLE_DE_CLE[a]).join(' et ')} absente(s) en production` }));
      return NextResponse.json(
        { error: 'Clé d’accès du catalogue non configurée.', requestId },
        { status: 503, headers: { 'x-request-id': requestId, 'retry-after': '60' } },
      );
    }
    console.info(JSON.stringify({ evenement: 'api.cle', requestId, etat: 'desarme',
      detail: `${appelants.map((a) => VARIABLE_DE_CLE[a]).join(' et ')} absente(s) hors production` }));
    return null;
  }
  const entete = request.headers.get('authorization')?.trim() ?? '';
  const fournie = /^Bearer\s+(.+)$/i.exec(entete)?.[1]?.trim() ?? '';
  // Chaque clé attendue est comparée, sans sortie anticipée : le temps de réponse ne dit pas laquelle a été reconnue.
  let reconnue = false;
  for (const attendue of attendues) reconnue = (fournie !== '' && egalesEnTempsConstant(fournie, attendue)) || reconnue;
  if (reconnue) return null;

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
