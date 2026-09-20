/**
 * LE LECTEUR D'AUDIT QUI JUGE PAR DIMENSION — et non plus par chemin.
 *
 * ── LE DÉFAUT QU'IL CORRIGE ────────────────────────────────────────────────────────────────────
 *
 * `lot0-lecteurs.ts` répond à la question « ce chemin porte-t-il une valeur ? ». Il ne lit jamais
 * CE QUE DIT la valeur. Sur un champ mixte, c'est une erreur de mesure :
 *
 *   `tags1: ["Full Time"]` déclaré pour la dimension `contrat` rend SIGNAL_VALIDE, donc
 *   PERTE_CONFIRMEE si `employmentTerm` est vide — alors que cette valeur ne dit RIEN d'un terme
 *   de contrat. Elle dit un RYTHME. La « perte » est un artefact du lecteur.
 *
 * ── POURQUOI CE LECTEUR RÉUTILISE LE CODE DE PRODUCTION ────────────────────────────────────────
 *
 * La chaîne de production ne raisonne pas « un chemin = une dimension ». `employment-paths.json`
 * déclare UNE liste commune (`tags1`…`tags6`, `contract`, `schedule`, `typeOfEmployment.label`…)
 * lue pour TOUTES les dimensions d'emploi, puis chaque valeur est décomposée par
 * `readEmployment` + `decomposeCompositeCode`, qui rendent un objet multi-dimensions
 * (`"PT Temp/Seasonal"` → workTime PART_TIME + employmentTerm FIXED_TERM + isSeasonal).
 *
 * Un audit qui mesure autrement mesure un produit qui n'existe pas. En réutilisant les mêmes
 * fonctions, la mesure cesse de diverger de ce que le code fait réellement — et tout écart
 * constaté devient un écart du PRODUIT, pas du lecteur.
 *
 * ── CE QU'IL NE FAIT PAS ───────────────────────────────────────────────────────────────────────
 *
 * Il ne remplace pas `lot0-lecteurs.ts` sur les dimensions non couvertes par le modèle d'emploi
 * (région, secteur, salaire…). Il ne traite QUE les quatre dimensions d'emploi plus la
 * saisonnalité, parce que ce sont les seules pour lesquelles le produit expose un décodeur par
 * valeur. Ailleurs, la question reste ouverte et doit le rester.
 */
import { readEmployment, decomposeCompositeCode } from '../../src/normalize/employment.js';

/** Les dimensions d'emploi qu'une valeur peut nommer. Une valeur peut en nommer plusieurs. */
export type DimensionEmploi = 'contrat' | 'temps' | 'programme' | 'nature' | 'saisonnier';

/** Ce qu'une valeur RAW nomme réellement, dimension par dimension. */
export type LectureValeur = Partial<Record<DimensionEmploi, string>>;

/**
 * Décode une valeur RAW avec le décodeur DE PRODUCTION, et rend ce qu'elle nomme.
 *
 * L'ordre du `spread` reprend `trust/resolve.ts` : `readEmployment` prime sur la décomposition
 * de code composite, parce qu'un libellé explicite est plus fiable qu'un token deviné.
 */
export function lireValeur(valeur: unknown): LectureValeur {
  if (typeof valeur !== 'string' || !valeur.trim()) return {};
  const e = { ...decomposeCompositeCode(valeur), ...readEmployment(valeur) };
  const out: LectureValeur = {};
  if (e.employmentTerm) out.contrat = e.employmentTerm;
  if (e.workTime) out.temps = e.workTime;
  if (e.programType) out.programme = e.programType;
  if (e.engagementType) out.nature = e.engagementType;
  if (e.isSeasonal) out.saisonnier = 'true';
  return out;
}

/**
 * Cette valeur nomme-t-elle CETTE dimension ?
 *
 * C'est la question que l'ancien lecteur ne posait pas. `"Full Time"` nomme `temps` et ne nomme
 * PAS `contrat` : sur la dimension `contrat`, elle ne prouve aucune perte.
 */
export function nommeLaDimension(valeur: unknown, dimension: DimensionEmploi): boolean {
  return lireValeur(valeur)[dimension] !== undefined;
}

/**
 * Le verdict d'une offre, pour une dimension d'emploi.
 *
 * SEPT états, parce que quatre ne suffisaient pas. La version initiale classait en
 * `RIEN_A_CANONISER` une valeur PRÉSENTE mais que le décodeur ne reconnaît pas — c'est-à-dire
 * qu'elle rangeait un angle mort du produit parmi les cas conformes. `"Non-guaranteed hours"`
 * en est l'exemple : le champ porte une information, le décodeur ne sait pas la lire, et l'audit
 * concluait « rien à canoniser ».
 *
 * ── CE SONT DES OBSERVATIONS, PAS DES VERDICTS PRODUIT ─────────────────────────────────────────
 *
 * Chaque état décrit ce que la MESURE a constaté. Aucun ne prouve à lui seul un défaut, et les
 * lire comme des conclusions reproduirait l'erreur de la première passe :
 *
 *  · `VALEUR_NON_RECONNUE` ne prouve PAS un défaut produit. La valeur peut être hors périmètre
 *    (un code interne, un libellé de site), ou son sens peut être ambigu au point qu'il soit
 *    JUSTE de ne pas la décoder — c'est le cas de `"Contract"`, refusé délibérément.
 *  · `NOMME_AUTRE_DIMENSION` ne prouve PAS un chemin mal déclaré. Un champ peut légitimement
 *    porter plusieurs dimensions selon l'offre : le chemin est alors correct, et c'est la valeur
 *    qui varie.
 *  · `CANONISE_DIVERGENT` et `SOURCES_CONTRADICTOIRES` ne prouvent PAS une erreur de
 *    canonisation : le produit arbitre par niveau de confiance (`trust/resolve.ts`), et cet
 *    arbitrage peut être correct contre la valeur brute.
 *
 * **Le contexte et le contrat du champ tranchent, jamais le seul état.** Ces verdicts servent à
 * ORIENTER une instruction, pas à la remplacer.
 */
export type VerdictDimension =
  | 'PERTE_CONFIRMEE'       // une valeur nomme la dimension, le canonique est vide
  | 'CANONISE_CONFORME'     // une valeur la nomme, le canonique porte la MÊME information
  | 'CANONISE_DIVERGENT'    // une valeur la nomme, le canonique porte AUTRE CHOSE
  | 'VALEUR_NON_RECONNUE'   // le champ porte une valeur, AUCUN décodeur ne sait la lire — trou du produit
  | 'NOMME_AUTRE_DIMENSION' // la valeur est lue, mais elle nomme une AUTRE dimension — chemin mal déclaré
  | 'SOURCES_CONTRADICTOIRES' // deux valeurs nomment la dimension DIFFÉREMMENT : l'arbitrage est à vérifier
  | 'RIEN_A_CANONISER'      // aucune valeur, ou que des valeurs vides
  | 'CANONISE_SANS_SOURCE'; // le canonique est rempli sans qu'aucune valeur ne le nomme

/** La forme canonique d'une valeur, pour une comparaison qui ne dépend ni de la casse ni du type. */
function formeComparable(v: unknown): string {
  return String(v).trim().toUpperCase();
}

/**
 * Croise ce que les valeurs NOMMENT et ce que le canonique PORTE.
 *
 * Trois règles, chacune corrigeant un défaut constaté :
 *
 *  1. La comparaison porte sur la VALEUR canonique, pas sur son remplissage. Une colonne remplie
 *     avec autre chose que ce que dit la source est un défaut distinct d'une colonne vide, et les
 *     confondre masque le pire des deux.
 *  2. Elle est insensible à la casse ET au type. `isSeasonal` est un booléen en base et `'true'`
 *     côté lecteur : comparer `'true'` à `'TRUE'` rendait un `CANONISE_DIVERGENT` permanent sur la
 *     saisonnalité, un faux positif intégral.
 *  3. Deux valeurs qui nomment la dimension DIFFÉREMMENT ne deviennent pas conformes parce que le
 *     canonique correspond à l'une d'elles. Le produit a peut-être arbitré correctement — mais
 *     c'est un ARBITRAGE, et il doit être vérifié, pas présumé juste.
 */
export function verdictDimension(
  valeurs: readonly unknown[], dimension: DimensionEmploi, canonique: unknown,
): VerdictDimension {
  const attendues = new Set<string>();
  let valeurPresente = false;
  let luePourUneAutreDimension = false;

  for (const v of valeurs) {
    if (v === null || v === undefined || String(v).trim() === '') continue;
    valeurPresente = true;
    const lecture = lireValeur(v);
    const lu = lecture[dimension];
    if (lu) attendues.add(formeComparable(lu));
    else if (Object.keys(lecture).length > 0) luePourUneAutreDimension = true;
  }

  const rempli = canonique !== null && canonique !== undefined && String(canonique).trim() !== '';

  if (!attendues.size) {
    if (valeurPresente && !rempli) {
      /*
       * DEUX SITUATIONS À NE PAS CONFONDRE, et c'est la distinction la plus utile de ce lecteur :
       *
       *  · la valeur est lue mais nomme une AUTRE dimension (`"Full Time"` interrogé sur
       *    `contrat`) → le décodeur fonctionne, c'est le CHEMIN DÉCLARÉ par l'audit qui est
       *    faux. Rien à corriger dans le produit ;
       *  · aucun décodeur ne sait la lire (`"Non-guaranteed hours"`) → c'est un TROU DU PRODUIT,
       *    et il faut l'instruire.
       *
       * Les ranger ensemble ferait passer un défaut réel pour une erreur de déclaration.
       */
      return luePourUneAutreDimension ? 'NOMME_AUTRE_DIMENSION' : 'VALEUR_NON_RECONNUE';
    }
    return rempli ? 'CANONISE_SANS_SOURCE' : 'RIEN_A_CANONISER';
  }

  if (!rempli) return 'PERTE_CONFIRMEE';

  const canon = formeComparable(canonique);
  if (attendues.size > 1) {
    // L'arbitrage réel doit être vérifié : que le canonique tombe sur l'une des deux ne dit pas
    // qu'il a choisi la bonne, ni même qu'il a choisi.
    return attendues.has(canon) ? 'SOURCES_CONTRADICTOIRES' : 'CANONISE_DIVERGENT';
  }
  return attendues.has(canon) ? 'CANONISE_CONFORME' : 'CANONISE_DIVERGENT';
}
