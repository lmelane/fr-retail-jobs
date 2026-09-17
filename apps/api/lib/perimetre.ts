import { CODES_MARCHE, perimetreDeRecherche, type Perimetre } from '@catwalks/db/marches';
import { PAYS_CONNUS } from './lieu';

export type { Perimetre } from '@catwalks/db/marches';

/**
 * LE PÉRIMÈTRE EST OBLIGATOIRE (lot 6, passation §12.5).
 *
 * Aucun pays absent, mal formé ou inconnu n'est transformé en recherche
 * mondiale — ni par l'API, ni par un repli du site. Le refus est explicite,
 * porte son motif et la liste des marchés ouverts, et c'est le site qui
 * propose alors le choix. Le défaut historique « `marche=US` → total mondial »
 * venait précisément d'un périmètre traité comme un décor de facettes.
 */
export class PerimetreRequisError extends Error {
  constructor(readonly code: 'MARCHE_REQUIS' | 'MARCHE_INCONNU', readonly demande: string | undefined) {
    super(code === 'MARCHE_REQUIS' ? 'Un marché est requis pour rechercher.' : `Marché inconnu : ${demande}`);
    this.name = 'PerimetreRequisError';
  }
  /** Le corps d'une réponse 400 : le motif et les marchés ouverts, jamais un résultat. */
  corps(requestId: string) {
    return { error: this.code, requestId, marches: [...CODES_MARCHE] };
  }
}

/** Le périmètre demandé, ou `undefined` : un marché mesuré, ou un pays connu servi seul. */
export function resoudrePerimetre(code: string | undefined): Perimetre | undefined {
  return perimetreDeRecherche(code, PAYS_CONNUS);
}

export function exigerPerimetre(code: string | undefined): Perimetre {
  const propre = code?.trim();
  if (!propre) throw new PerimetreRequisError('MARCHE_REQUIS', undefined);
  const perimetre = resoudrePerimetre(propre);
  if (!perimetre) throw new PerimetreRequisError('MARCHE_INCONNU', propre.slice(0, 20));
  return perimetre;
}
