/**
 * LE CONTRAT ANNONCÉ PAR LE CLIENT (D-496, D-499).
 *
 * La proximité change ce qu'un client voit : les lieux suggérés (« Paris (75) »), le lieu compris, les cercles, l'ordre
 * (par fraîcheur depuis D-510 ; par distance avant), les comptes et les facettes. La production sert un site qui ne la connaît pas (catwalks.io, branche
 * `main`), et la préversion du site, sans agrégateur à elle, interroge la même API. Le nouveau contrat n'est donc servi
 * qu'au client qui l'annonce par cet en-tête ; sans lui, l'API répond comme avant le lot, à l'identique
 * (`contrat-v1-d496.test.ts`). Quand le site qui l'envoie sera promu, la production basculera d'elle-même.
 *
 * Un en-tête plutôt qu'un paramètre : le client le pose une fois sur tous ses appels, et il n'entre ni dans les liens
 * partagés ni dans les curseurs. Aucune réponse de ces routes n'est mise en cache public.
 */
export const ENTETE_CONTRAT_CLIENT = 'x-catwalks-client';
/** La première version du contrat qui sert la proximité. */
export const CONTRAT_PROXIMITE = 2;

/**
 * Le client annonce-t-il un contrat qui connaît la proximité ? Toute autre valeur, ou rien : le contrat d'avant.
 *
 * D-500, D-501 : le même contrat porte aussi la requête comprise, les suggestions canoniques
 * et les lieux de tête (`annonceComprehension`) : catwalks.io ne voit rien changer avant la promotion du site (D-490).
 */
export function annonceProximite(entetes: Pick<Headers, 'get'>): boolean {
  const brut = entetes.get(ENTETE_CONTRAT_CLIENT)?.trim() ?? '';
  return /^\d{1,3}$/.test(brut) && Number(brut) >= CONTRAT_PROXIMITE;
}

/** D-500, D-501 : la requête comprise et les suggestions canoniques, au même client. */
export function annonceComprehension(entetes: Pick<Headers, 'get'>): boolean {
  return annonceProximite(entetes);
}

/**
 * D-510 : le tri par fraîcheur (Catwalks d'abord, puis la plus fraîche, `fraicheur.ts`), au même client. Il remplace,
 * à ce contrat, la distance (D-496), la pertinence et le classement par le titre (D-500 Q4) et le pays du visiteur
 * (D-419 §2) ; sans l'en-tête, l'ordre d'avant, à l'identique.
 */
export function annonceFraicheur(entetes: Pick<Headers, 'get'>): boolean {
  return annonceProximite(entetes);
}
