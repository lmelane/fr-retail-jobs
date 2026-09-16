import { countryCode, countryLabel } from './countries';
import { knownAlpha2 } from './iso-alpha2';

/**
 * Résolution du champ « lieu » du moteur (D-418 §3, lot 6).
 *
 * `lieu` est ce qu'une personne TAPE dans le second champ de la barre :
 * « Ville, département, code postal ou Télétravail » (passation §2.4). Il se
 * résout ICI, côté moteur, jamais dans un front : une seule règle pour tous
 * les consommateurs. La résolution est PURE — elle ne connaît pas le périmètre
 * de la recherche ; c'est le plan de recherche qui refuse ensuite un pays hors
 * marché (`LIEU_HORS_MARCHE`), explicitement et jamais en silence.
 *
 * Règle :
 *  - télétravail (fr/en) ⇒ mode de travail `REMOTE`, dans le périmètre ;
 *  - un code postal (chiffres, ou formats britannique, canadien, néerlandais)
 *    ⇒ préfixe sur `Job.postalCode`, chaîne conservée telle quelle ;
 *  - un code ISO-2 connu ou un nom de pays reconnu ⇒ un pays, accepté
 *    seulement s'il appartient au périmètre — « Aucun choix de pays dans
 *    l'input 2 » : ce champ ne change jamais de marché ;
 *  - tout le reste ⇒ un lieu en correspondance large : ville (égalité ou
 *    préfixe), subdivision (`adminArea1`, égalité) ou présence dans le libellé.
 *
 * `libelle` : ce que le front affiche pour dire ce qu'il a compris (audit UX
 * 14/09, H3 : « à Pari », « à France » mentaient) — jamais la saisie brute.
 */
export type LieuResolu =
  | { type: 'pays'; country: string; libelle: string }
  | { type: 'ville'; cityLoose: string; libelle: string }
  | { type: 'codePostal'; postalCode: string; libelle: string }
  | { type: 'teletravail'; remote: true; libelle: string };

const CODES_CONNUS = new Set(knownAlpha2());
const TELETRAVAIL = /^(t[ée]l[ée]travail|remote|(à|a) distance|home ?office|full remote|100 ?% remote)$/i;
/**
 * Les formes postales reconnues : numériques (FR, US, DE, IT, ES, CH, AU, CN…),
 * britannique (« SW1A 1AA », « M1 1AE »), canadienne (« H2Y 1C6 »),
 * néerlandaise (« 1012 AB »). « Paris 8 » n'en est pas une : c'est une ville.
 */
const CODE_POSTAL = [/^\d{3,10}$/, /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/, /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/, /^\d{4}\s?[A-Z]{2}$/];

function capitaliser(v: string): string {
  return v.replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, l: string) => sep + l.toUpperCase());
}

export function resolveLieu(raw: string | null | undefined): LieuResolu | null {
  const texte = raw?.trim().replace(/\s+/g, ' ');
  if (!texte) return null;
  const cle = texte.toLowerCase();

  if (TELETRAVAIL.test(cle)) return { type: 'teletravail', remote: true, libelle: 'Télétravail' };

  const postal = texte.toUpperCase();
  if (CODE_POSTAL.some((forme) => forme.test(postal))) return { type: 'codePostal', postalCode: postal, libelle: postal };

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

/** Le pays est-il un code ISO 3166-1 alpha-2 réellement attribué ? */
export function paysConnu(code: string): boolean {
  return CODES_CONNUS.has(code);
}

export const PAYS_CONNUS: ReadonlySet<string> = CODES_CONNUS;
