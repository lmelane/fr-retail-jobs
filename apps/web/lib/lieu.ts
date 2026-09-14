import { countryCode } from './countries';
import { knownAlpha2 } from './intelligence/country-ids';

/**
 * Résolution TOLÉRANTE du champ « lieu » du moteur (D-418 §3, catwalks.io).
 *
 * `ville` (paramètre historique) est une égalité stricte sur `Job.city` :
 * elle suppose une autocomplétion et rend zéro sur « Pari » ou « France ».
 * `lieu` est ce qu'une personne TAPE : une ville, un pays (nom français ou
 * anglais, code ISO-2), sans garantie d'orthographe. Il se résout ICI, côté
 * moteur, jamais dans un front : une seule règle pour tous les consommateurs.
 *
 * Règle : un code ISO-2 CONNU ou un nom de pays reconnu ⇒ filtre pays ;
 * tout le reste ⇒ ville en correspondance large (égalité, préfixe, ou
 * présence dans `location`). Un pays l'emporte sur une ville homonyme
 * (« Monaco », « Luxembourg ») : l'ensemble le plus large, jamais le plus
 * étroit, sur une saisie ambiguë.
 */
export type LieuResolu = { country: string } | { cityLoose: string };

const CODES_CONNUS = new Set(knownAlpha2());

export function resolveLieu(raw: string | null | undefined): LieuResolu | null {
  const texte = raw?.trim().replace(/\s+/g, ' ');
  if (!texte) return null;
  const cle = texte.toLowerCase();

  // Deux lettres : un code ISO seulement s'il existe ; sinon « pa » reste une
  // saisie de ville (préfixe), pas le Panama.
  if (/^[a-z]{2}$/.test(cle)) {
    const code = cle.toUpperCase();
    return CODES_CONNUS.has(code) ? { country: code } : { cityLoose: texte };
  }

  // Trois lettres et plus : la table d'alias (fr/en, codes alpha-3, Intl).
  const code = countryCode(texte);
  if (code && CODES_CONNUS.has(code)) return { country: code };

  return { cityLoose: texte };
}
