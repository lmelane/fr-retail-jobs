/**
 * LES LECTEURS DE L'AUDIT — extraits et testables.
 *
 * ── POURQUOI CE MODULE EXISTE ──────────────────────────────────────────────────────────────────
 *
 * La première consolidation a produit des chiffres faux parce que ses lecteurs vivaient à
 * l'intérieur d'un script à usage unique, sans test. Trois défauts en sont sortis :
 *
 *   · `LAT_LNG` — un encodage de position — comptait comme un signal de télétravail, parce qu'une
 *     chaîne non vide était tenue pour une valeur utile ;
 *   · la perte était calculée par soustraction (`signal − canonisé`), ce qui mélange des offres
 *     différentes : une offre canonisée SANS signal et une offre avec signal NON canonisée
 *     s'annulent dans la soustraction alors que ce sont deux anomalies distinctes ;
 *   · une liste de chemins vide produisait « absent » au lieu de « non mesuré ».
 *
 * Un `tsc` vert ne dit rien de tout cela. Ces fonctions sont donc extraites ici pour être
 * éprouvées par des témoins qui échouent quand le défaut revient.
 *
 * ── LE PRINCIPE : LA VALIDITÉ DÉPEND DU CONTRAT DU CHAMP ───────────────────────────────────────
 *
 * Il n'existe PAS de règle universelle de « valeur utile ». `false` sur `remote` est une
 * information valide (« pas de télétravail ») ; `0` sur `salary_min_value` chez JIBE est une
 * absence. Le même littéral porte deux sens selon le champ et la source — d'où une validité
 * déclarée par (dimension, source), jamais devinée.
 */

/** Ce qu'une mesure peut conclure sur une offre, pour une dimension. */
export type EtatSignal =
  | 'SIGNAL_VALIDE'      // le RAW porte une valeur exploitable
  | 'SIGNAL_SENTINELLE'  // le RAW porte une valeur, mais elle ne dit rien (LAT_LNG, 0, Other…)
  | 'SIGNAL_ABSENT'      // le RAW ne porte pas le chemin
  | 'NON_MESURE';        // aucun chemin déclaré pour cette (dimension, source) — ignorance, pas absence

/**
 * Les valeurs qui ne portent aucune information, PAR DIMENSION.
 *
 * `LAT_LNG` est ici et nulle part ailleurs : c'est la valeur de `location_type` chez JIBE, qui
 * décrit comment la position est encodée (latitude/longitude) et jamais un mode de travail.
 * Mesuré sur 10 024 des 10 035 offres JIBE — la compter validerait un télétravail imaginaire sur
 * la moitié du marché américain.
 */
const SENTINELLES_PAR_DIMENSION: Record<string, ReadonlySet<string>> = {
  teletravail: new Set(['lat_lng', 'latlng', 'unknown', 'none', 'n/a', '']),
  departement: new Set(['other', 'autre', 'job', 'divers', 'misc', 'n/a', '']),
  contrat: new Set(['other', 'unknown', 'n/a', '']),
  temps: new Set(['unknown', 'n/a', '']),
  experience: new Set(['unknown', 'n/a', '']),
  salaire: new Set(['0', '0.0', '0.00', 'competitive', 'doe', 'negotiable', 'n/a', '']),
  secteur: new Set(['other', 'n/a', '']),
};

/** Les placeholders textuels communs à toutes les dimensions. */
const PLACEHOLDERS = /^(n\/?a|null|none|nil|-|--|tbd|to be defined|unknown|undefined)$/i;

/**
 * Une valeur du RAW porte-t-elle une information, pour cette dimension ?
 *
 * `accepteFaux` : sur `remote`/`hybrid`, `false` SIGNIFIE « pas de télétravail » — c'est une
 * information, pas une absence. Sur un champ où `false` n'a pas de sens déclaré, il ne prouve
 * rien. Le contrat est donc porté par l'appelant, jamais deviné ici.
 */
export function estSignalValide(valeur: unknown, dimension: string, accepteFaux = false): boolean {
  if (valeur === null || valeur === undefined) return false;

  if (typeof valeur === 'boolean') return accepteFaux ? true : valeur;

  if (typeof valeur === 'number') {
    if (!Number.isFinite(valeur)) return false;
    // Un zéro n'est une absence que là où le contrat le dit (salaire chez JIBE, mesuré).
    return SENTINELLES_PAR_DIMENSION[dimension]?.has(String(valeur)) ? false : true;
  }

  if (typeof valeur === 'string') {
    const t = valeur.trim();
    if (t === '' || PLACEHOLDERS.test(t)) return false;
    return !(SENTINELLES_PAR_DIMENSION[dimension]?.has(t.toLowerCase()) ?? false);
  }

  /*
   * OBJETS ET TABLEAUX. Un tableau vide, un objet vide, ou un objet dont TOUTES les valeurs sont
   * nulles ne portent rien — c'est le cas mesuré de `{"max": null, "min": null, "period": null,
   * "currency": null}` sur 1 277 offres françaises. Un tableau non vide, lui, porte l'information
   * (`categories: [{name: "Salon Professionals"}]` chez JIBE, `tags1: ["Part Time"]`).
   */
  if (Array.isArray(valeur)) return valeur.some((x) => estSignalValide(x, dimension, accepteFaux));
  if (typeof valeur === 'object') {
    const vals = Object.values(valeur as Record<string, unknown>);
    return vals.length > 0 && vals.some((x) => estSignalValide(x, dimension, accepteFaux));
  }
  return false;
}

/**
 * Lit un chemin pointé (`a.b.c`) dans un RAW, en traversant les tableaux.
 *
 * Les tableaux sont traversés parce que le signal y vit souvent : `tags1: ["Part Time"]`,
 * `categories: [{name: "…"}]`, `locations: [{country: "…"}]`. S'arrêter à la racine reviendrait à
 * déclarer « absent » un champ qui est simplement niché — l'erreur exacte de la première passe.
 */
export function lireChemin(raw: unknown, chemin: string): unknown[] {
  const parts = chemin.split('.');
  let courant: unknown[] = [raw];
  for (const p of parts) {
    const suivant: unknown[] = [];
    for (const c of courant) {
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) { for (const e of c) if (e && typeof e === 'object') suivant.push((e as Record<string, unknown>)[p]); continue; }
      if (typeof c === 'object') suivant.push((c as Record<string, unknown>)[p]);
    }
    courant = suivant;
    if (!courant.length) return [];
  }
  return courant.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => v !== undefined);
}

/**
 * L'état du signal d'une offre pour une dimension.
 *
 * Distingue les QUATRE états, dont le plus important : une liste de chemins VIDE rend
 * `NON_MESURE`, jamais `SIGNAL_ABSENT`. Confondre « je n'ai pas cherché » et « il n'y a rien »
 * transforme une ignorance en constat, et c'est ainsi qu'un défaut devient un ticket.
 */
export function etatSignal(
  raw: unknown, chemins: readonly string[], dimension: string, accepteFaux = false,
): EtatSignal {
  if (!chemins.length) return 'NON_MESURE';
  let vuSentinelle = false;
  for (const chemin of chemins) {
    for (const v of lireChemin(raw, chemin)) {
      if (estSignalValide(v, dimension, accepteFaux)) return 'SIGNAL_VALIDE';
      if (v !== null && v !== undefined) vuSentinelle = true;
    }
  }
  return vuSentinelle ? 'SIGNAL_SENTINELLE' : 'SIGNAL_ABSENT';
}

/** Le verdict d'une offre : le croisement de son signal RAW et de sa valeur canonique. */
export type VerdictOffre =
  | 'PERTE_CONFIRMEE'       // signal valide, canonique vide — le défaut à corriger
  | 'CANONISE'              // signal valide, canonique rempli
  | 'CANONISE_SANS_SIGNAL'  // canonique rempli sans signal RAW mesuré : déduction ou chemin non mesuré
  | 'RIEN_A_CANONISER'      // pas de signal, pas de canonique — conforme
  | 'NON_MESURE';           // aucun chemin déclaré

/**
 * Croise le signal et le canonique, OFFRE PAR OFFRE.
 *
 * C'est le cœur du correctif. La première passe calculait la perte par `signal − canonisé`, une
 * soustraction d'agrégats : une offre canonisée sans signal et une offre à signal perdu
 * s'annulaient, et la perte affichée était fausse dans les deux sens. Ici chaque offre reçoit un
 * verdict, et les totaux se comptent.
 *
 * `CANONISE_SANS_SIGNAL` n'est pas une anomalie en soi : la valeur peut venir d'un chemin qu'on
 * n'a pas déclaré, ou d'une déduction légitime. C'est un signal d'INCOMPLÉTUDE DE LA MESURE, à
 * instruire avant d'en conclure quoi que ce soit.
 */
export function verdictOffre(etat: EtatSignal, canoniqueRempli: boolean): VerdictOffre {
  if (etat === 'NON_MESURE') return 'NON_MESURE';
  if (etat === 'SIGNAL_VALIDE') return canoniqueRempli ? 'CANONISE' : 'PERTE_CONFIRMEE';
  return canoniqueRempli ? 'CANONISE_SANS_SIGNAL' : 'RIEN_A_CANONISER';
}
