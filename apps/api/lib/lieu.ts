import { countryCode, countryLabel } from './countries';
import { knownAlpha2 } from './intelligence/country-ids';

/**
 * Résolution TOLÉRANTE du champ « lieu » du moteur (D-418 §3, catwalks.io).
 *
 * `ville` (paramètre historique) est une égalité stricte sur `Job.city` :
 * elle suppose une autocomplétion et rend zéro sur « Pari » ou « France ».
 * `lieu` est ce qu'une personne TAPE : une ville, un pays (nom français ou
 * anglais, code ISO-2), « télétravail », sans garantie d'orthographe. Il se
 * résout ICI, côté moteur, jamais dans un front : une seule règle pour tous
 * les consommateurs.
 *
 * Règle : télétravail (fr/en) ⇒ filtre `workplaceType = REMOTE` ; un code
 * ISO-2 connu ou un nom de pays reconnu ⇒ filtre pays ; tout le reste ⇒ ville
 * en correspondance large (égalité, préfixe, ou présence dans `location`).
 * Un pays l'emporte sur une ville homonyme (« Monaco », « Luxembourg ») :
 * l'ensemble le plus large, jamais le plus étroit, sur une saisie ambiguë.
 *
 * `libelle` : ce que le front affiche pour dire ce qu'il a compris (audit
 * UX 14/09, H3 : « à Pari », « à France » mentaient) — jamais la saisie brute.
 */
export type LieuResolu =
  | { type: 'pays'; country: string; libelle: string }
  | { type: 'ville'; cityLoose: string; libelle: string }
  | { type: 'teletravail'; remote: true; libelle: string };

const CODES_CONNUS = new Set(knownAlpha2());
const TELETRAVAIL = /^(t[ée]l[ée]travail|remote|(à|a) distance|home ?office|full remote|100 ?% remote)$/i;

function capitaliser(v: string): string {
  return v.replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, l: string) => sep + l.toUpperCase());
}

export function resolveLieu(raw: string | null | undefined): LieuResolu | null {
  const texte = raw?.trim().replace(/\s+/g, ' ');
  if (!texte) return null;
  const cle = texte.toLowerCase();

  if (TELETRAVAIL.test(cle)) return { type: 'teletravail', remote: true, libelle: 'Télétravail' };

  // Deux lettres : un code ISO connu ou un alias (uk → GB) ; sinon « pa »
  // reste une saisie de ville (préfixe), pas le Panama.
  if (/^[a-z]{2}$/.test(cle)) {
    const code = countryCode(cle);
    if (code && CODES_CONNUS.has(code)) return { type: 'pays', country: code, libelle: countryLabel(code) };
    return { type: 'ville', cityLoose: texte, libelle: capitaliser(texte) };
  }

  // Trois lettres et plus : la table d'alias (fr/en, codes alpha-3, Intl).
  const code = countryCode(texte);
  if (code && CODES_CONNUS.has(code)) return { type: 'pays', country: code, libelle: countryLabel(code) };

  return { type: 'ville', cityLoose: texte, libelle: capitaliser(texte) };
}
