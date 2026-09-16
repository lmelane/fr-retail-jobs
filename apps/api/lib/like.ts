/**
 * Échappe les métacaractères de `LIKE` dans une saisie utilisateur.
 *
 * Sans ça, un candidat qui tape « % » reçoit la liste des huit plus grosses
 * villes du catalogue au lieu de rien, et « _ » fait correspondre n'importe
 * quel caractère. Ce n'est pas une injection — la valeur reste un paramètre
 * lié — mais c'est un comportement faux, et il est visible : le panneau
 * affiche des villes qui n'ont aucun rapport avec la frappe. La même règle
 * vaut pour le champ lieu et la recherche texte (lot 6).
 *
 * `\` d'abord, sinon on ré-échapperait les antislashs qu'on vient d'ajouter.
 */
export function echapperLike(valeur: string): string {
  return valeur.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
