import { MOTS_DE_LIAISON, searchWords } from './search-intent.ts';

export { MOTS_DE_LIAISON };

/**
 * D-500 (Q1) — CE QUE LA RECHERCHE COMPREND D'UNE REQUÊTE TAPÉE, AVANT DE LA LIRE.
 *
 * Mesuré en production le 01/10/2026 (`audits/2026-10-01/d500-requete/` de l'agrégateur) : le moteur est trop littéral
 * dans trois cas précis, et les suggestions d'intitulés bruts les fabriquent :
 *  - l'écriture inclusive : « conseiller(ère) de vente » cherchait les quatre mots « conseiller », « ere », « de »,
 *    « vente » et perdait 80 % des offres du métier en France ;
 *  - les marqueurs sans contenu : « CONSEILLER DE VENTE /NB » exigeait le mot « nb » (96 % des offres perdues) ;
 *  - un mot seul au féminin ou au pluriel : « conseillère » ne trouvait pas « Conseiller de vente ».
 *
 * Tout ce module agit sur la REQUÊTE (ou sur une copie d'intitulé servie à l'autocomplétion), jamais sur le titre natif
 * d'une offre, qui reste tel que l'employeur l'a écrit ([[D-500]] §3).
 */

/** Les terminaisons d'une écriture inclusive : « (ère) », « ·rice », « .e », « /se », « *in »… (sans accents ni casse). */
const SUFFIXES = ['e', 'es', 'ere', 'eres', 'euse', 'euses', 'se', 'ses', 'rice', 'rices', 'trice', 'trices', 'ice', 'ienne',
  'iennes', 'enne', 'ne', 'le', 'te', 'fe', 've', 'a', 'as'];
const SUFFIXES_PARENTHESE = [...SUFFIXES, 's', 'x', 'in', 'innen'];
const SUFFIXES_TIRET = ['e', 'ere', 'euse', 'rice', 'trice', 'ienne'];
const SUFFIXES_ALLEMANDS = ['in', 'innen'];

const sansAccents = (v: string) => v.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const estSuffixe = (v: string, liste: readonly string[]) => liste.includes(sansAccents(v.trim()));
/** `autre` est-il une forme genrée (ou plurielle) de `mot` ? « conseillère » de « conseiller », « directrice » de « directeur ». */
const formeGenree = (mot: string, autre: string) => {
  const m = sansAccents(mot), a = sansAccents(autre);
  return m !== a && (formesDeBase(a).includes(m) || formesDeBase(m).includes(a));
};

/** Une marque de genre : une lettre (h, f, m, w, d, x), « nb », « div », « all ». */
const MARQUE = String.raw`(?:[hfmwdx]|nb|div|all)`;
const MARQUES: RegExp[] = [
  // « (H/F) », « (m/w/d) », « (x) », « (F/H/NB) », « ( h - f ) »
  new RegExp(String.raw`\(\s*${MARQUE}(?:\s*[/,|-]\s*${MARQUE})*\s*\)`, 'giu'),
  // « H/F », « F/H », « m/w/d », « H/F/X » : au moins une barre, chaque élément une marque, rien de collé autour.
  new RegExp(String.raw`(?<![\p{L}\p{N}])${MARQUE}(?:\s*/\s*${MARQUE})+(?![\p{L}\p{N}])\)?`, 'giu'),
  // « /NB », « /X », « /d) » : une marque introduite par une barre.
  /\/\s*(?:nb|x|d)(?![\p{L}\p{N}])\)?/giu,
  // « H.F », « F-H », « h.f. » : la même marque, à la ponctuation près.
  /(?<![\p{L}\p{N}])[hf]\s*[.-]\s*[hf](?![\p{L}\p{N}])\.?/giu,
];

/**
 * LA REQUÊTE REPLIÉE : l'écriture inclusive ramenée à la forme de son premier mot, les marques de genre sans contenu
 * retirées. Casse et accents gardés (le résultat sert aussi à l'affichage d'une suggestion) ; tout le reste (contrat,
 * ville, niveau, « luxe ») reste un mot de la requête, comme chez Indeed.
 *
 *   « conseiller(ère) de vente » → « conseiller de vente » ; « conseiller·ère » et « conseiller.e.s » → « conseiller » ;
 *   « vendeur/vendeuse » → « vendeur » ; « directeur/rice » → « directeur » ; « Verkäufer*in » → « Verkäufer » ;
 *   « CONSEILLER DE VENTE /NB » → « CONSEILLER DE VENTE » ; « conseillère de vente H/F » → « conseillère de vente ».
 */
export function replierRequete(texte: string): string {
  let s = texte.normalize('NFC');
  for (const m of MARQUES) s = s.replace(m, ' ');
  s = s
    // « conseiller(ère) », « vendeur (se) », « vendeur(s) »
    .replace(/(\p{L}{3,})\s?\(\s*(\p{L}{1,6})\s*\)/gu, (tout, mot: string, fin: string) => (estSuffixe(fin, SUFFIXES_PARENTHESE) ? mot : tout))
    // « conseiller·ère », « conseiller.e.s », « vendeur.se » (le point seul ne porte jamais « in » : « linked.in »)
    .replace(/(\p{L}{3,})[·•⋅∙.](\p{L}{1,6})(?:[·•⋅∙.](?:s|es))?(?![\p{L}\p{N}])/gu, (tout, mot: string, fin: string) => (estSuffixe(fin, SUFFIXES) ? mot : tout))
    // « Verkäufer*in », « Verkäufer:innen », « Verkäufer_in »
    .replace(/(\p{L}{3,})[*:_](\p{L}{2,5})(?![\p{L}\p{N}])/gu, (tout, mot: string, fin: string) => (estSuffixe(fin, SUFFIXES_ALLEMANDS) ? mot : tout))
    // « chargé-e », « conseiller-ère » (jamais « make-up » : la fin doit être une terminaison)
    .replace(/(\p{L}{3,})-(\p{L}{1,6})(?![\p{L}\p{N}])/gu, (tout, mot: string, fin: string) => (estSuffixe(fin, SUFFIXES_TIRET) ? mot : tout))
    // « directeur/rice », « vendeur / se », « addetto/a », « Verkäufer/in », puis « conseiller/conseillère » : le second
    // mot n'est replié que s'il est une forme genrée du premier (« communication/community », « marketing/marketplace »
    // restent deux mots ; audit technique du 01/10/2026).
    .replace(/(\p{L}{3,})\s*\/\s*(\p{L}{1,})(?![\p{L}\p{N}])/gu, (tout, mot: string, autre: string) =>
      estSuffixe(autre, [...SUFFIXES, ...SUFFIXES_ALLEMANDS]) || (autre.length >= 3 && formeGenree(mot, autre)) ? mot : tout);
  return s.replace(/\s+/g, ' ').trim();
}

/** Les mots d'une expression déjà normalisée (`searchWords`), sans ses mots de liaison. */
export const sansLiaisons = (mots: readonly string[]) => mots.filter((m) => !MOTS_DE_LIAISON.has(m));

/**
 * Les formes de base possibles d'UN mot tapé (déjà normalisé : minuscules, sans accents) : son singulier et son
 * masculin, par des règles de terminaison du français, de l'espagnol, de l'italien, du portugais, de l'allemand et de
 * l'anglais. Brutes : l'appelant ne garde que celles que le vocabulaire des métiers connaît (« paris » ne devient jamais
 * « pari »), et ne les applique qu'au mot tapé, jamais à une variante du manifeste.
 */
const FEMININS: [RegExp, string][] = [
  [/trice$/, 'teur'], [/ienne$/, 'ien'], [/enne$/, 'en'], [/iere$/, 'ier'], [/ere$/, 'er'], [/euse$/, 'eur'], [/effe$/, 'ef'],
  [/elle$/, 'el'], [/ive$/, 'if'], [/ante$/, 'ant'], [/ente$/, 'ent'], [/ointe$/, 'oint'], [/ee$/, 'e'], [/erin$/, 'er'],
  [/innen$/, ''], [/in$/, ''], [/frau$/, 'mann'], [/ora$/, 'or'], [/etta$/, 'etto'], [/essa$/, 'esso'], [/ata$/, 'ato'],
  [/ada$/, 'ado'], [/a$/, 'o'], [/e$/, ''],
];
export function formesDeBase(mot: string): string[] {
  if (mot.length < 4 || !/^\p{L}+$/u.test(mot)) return [];
  const singuliers = new Set<string>([mot]);
  if (/aux$/.test(mot)) singuliers.add(mot.replace(/aux$/, 'al'));
  if (/[^su]s$/.test(mot) || /[^aeiou]es$/.test(mot)) singuliers.add(mot.slice(0, -1));
  if (/x$/.test(mot) && !/aux$/.test(mot)) singuliers.add(mot.slice(0, -1));
  const formes = new Set<string>(singuliers);
  for (const s of singuliers) for (const [re, fin] of FEMININS) if (re.test(s) && s.length > fin.length + 2) formes.add(s.replace(re, fin));
  formes.delete(mot);
  return [...formes].filter((f) => f.length >= 3);
}

/** Les mots de toutes les expressions données : le lexique qui borne `formesDeBase`. */
export function lexiqueDe(expressions: Iterable<string>): Set<string> {
  const mots = new Set<string>();
  for (const e of expressions) for (const m of searchWords(e)) mots.add(m);
  return mots;
}
