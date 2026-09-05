/**
 * Domaine de marque, isolé du composant : fonction pure, donc testable et
 * réutilisable côté serveur (route /api/logo).
 */

/**
 * Domaine de marque deviné depuis le nom.
 *
 * Mesuré le 2026-09-05 : 18 des 30 plus grosses Maisons n'avaient pas de logo,
 * et la cause n'était PAS le fournisseur (DuckDuckGo rend bien 15 Ko pour
 * Sephora, 35 Ko pour Crocs) mais le domaine fabriqué :
 * `parfumschanel.com`, `tiffanyand.com`, `footlockerfrance.com`,
 * `mangomngsa.com`, `esteelaudercompanies.com` n'existent pas. Une fois les
 * qualificatifs retirés, 7 de ces 8 cas retrouvent leur logo (chanel.com,
 * tiffany.com, mango.com, elcompanies.com, dior.com…).
 *
 * On retire donc ce qui n'appartient pas au domaine : la gamme en préfixe
 * (« Parfums Chanel »), le pays en suffixe (« Foot Locker France »), la forme
 * juridique et les mots de structure. Ce qui reste est le nom de marque, qui
 * est presque toujours le domaine.
 */
const NAME_NOISE =
  /\b(inc|llc|ltd|limited|gmbh|s\.?a\.?s?|sarl|b\.?v|plc|co|corp|company|companies|group|groupe|holding|holdings|maison|couture|parfums?|beaute|beauty|cosmetics|fragrances|france|paris|usa|uk|deutschland|italia|espana|international|worldwide|stores?|retail|mng)\b\.?/g;

export function guessDomain(name: string): string | null {
  const cleaned = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    // Le nettoyage AVANT la conversion du « & » : sinon « Tiffany & Co. »
    // devient « tiffanyandco » puis « tiffanyand » — le « Co. » est mangé mais
    // le « and » reste, et tiffanyand.com n'existe pas.
    .replace(NAME_NOISE, ' ')
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]/g, '');
  // Un nom qui n'est QUE des mots de structure (« Groupe », « Company ») serait
  // vidé : on repart alors du nom brut plutôt que de rendre le monogramme d'un
  // nom pourtant utilisable.
  if (cleaned.length < 3) {
    const raw = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    return raw.length >= 3 ? `${raw}.com` : null;
  }
  // Sous 3 caractères il ne reste plus un nom de marque mais un fragment : mieux
  // vaut le monogramme qu'un domaine au hasard.
  if (cleaned.length < 3) return null;
  return `${cleaned}.com`;
}
