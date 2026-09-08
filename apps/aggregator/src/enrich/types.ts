/**
 * DATA ENRICHMENT ENGINE — le contrat d'architecture.
 *
 * Trois couches, posées par Loïc le 2026-09-08 et non négociables :
 *
 *   `raw` existant          → SOURCE  : le payload de la source, déjà en base
 *   colonnes canoniques     → SERVING : ce que le produit, les filtres et
 *                                       l'observatoire lisent. La vérité
 *                                       opérationnelle.
 *   `enrichment` (JSONB)    → PROVENANCE : comment on est arrivé à la valeur,
 *                                       avec quelle méthode, quelle confiance,
 *                                       quelle version de normaliseur.
 *
 * RÈGLE 1 — le JSONB est de la TRAÇABILITÉ, pas une dépendance produit. Le
 * front, les filtres et les statistiques continuent de lire `Job.contract`,
 * `Job.country`… et ne vont JAMAIS chercher la valeur normalisée dans
 * `enrichment`. Si un jour une lecture produit passe par ce module, c'est que
 * l'architecture a dérivé.
 *
 * RÈGLE 2 — le moteur est REJOUABLE et DÉTERMINISTE : mêmes entrées, même
 * sortie, sans réseau. C'est ce qui permet `contract-v1 → contract-v2` rejoué
 * sur 70 000 offres sans re-scraper une seule source.
 */

/**
 * RÈGLE 3 — `method` est un enum FERMÉ, jamais du texte libre.
 *
 * L'ordre de déclaration EST l'ordre de priorité (règle 4) : une information
 * explicitement fournie par la source bat toujours une inférence. Une
 * heuristique ne doit jamais écraser une donnée explicite fiable.
 */
export const METHODS = [
  /** Le champ dédié de la source le dit (« employmentType: Permanent »). */
  'RAW_FIELD',
  /** Une métadonnée de la source, hors champ dédié (tags, catégories, facettes). */
  'SOURCE_METADATA',
  /** L'intitulé du poste le dit (« CDI 18H — Vendeur »). */
  'TITLE',
  /** Le texte de l'offre le dit (« CDI à pourvoir »). */
  'DESCRIPTION',
  /** Déduit du croisement de plusieurs champs (ville → pays, par exemple). */
  'CROSS_FIELD',
  /** Réservé : inférence par modèle. Aucun producteur aujourd'hui. */
  'MODEL_INFERENCE',
  /**
   * RÈGLE 5 — correction humaine. Verrou : un replay automatique ne peut JAMAIS
   * l'écraser. C'est la condition pour que le moteur soit industrialisable.
   */
  'MANUAL',
] as const;

export type EnrichmentMethod = (typeof METHODS)[number];

/** Le rang de priorité d'une méthode : plus petit = plus fort (règle 4). */
const RANK = new Map<EnrichmentMethod, number>(METHODS.map((m, i) => [m, i]));

/**
 * `a` l'emporte-t-il sur `b` ?
 *
 * MANUAL est traité à part : il gagne contre tout, y compris contre un
 * RAW_FIELD, parce qu'un humain qui corrige a vu quelque chose que la source
 * ne dit pas.
 */
export function outranks(a: EnrichmentMethod, b: EnrichmentMethod): boolean {
  if (a === 'MANUAL') return b !== 'MANUAL';
  if (b === 'MANUAL') return false;
  return (RANK.get(a) ?? Number.MAX_SAFE_INTEGER) < (RANK.get(b) ?? Number.MAX_SAFE_INTEGER);
}

/**
 * RÈGLE 7 — la convention de confiance, commune à TOUS les enrichissements.
 *
 * Le but n'est pas d'inventer de la précision mathématique : c'est de
 * distinguer quatre situations, de façon stable et comparable d'un champ à
 * l'autre.
 */
export const CONFIDENCE = {
  /** La source l'écrit explicitement et le mot est reconnu sans ambiguïté. */
  CERTAIN: 1,
  /** Signal fort mais indirect : un token non ambigu dans le texte. */
  VERY_LIKELY: 0.9,
  /** Signal plausible mais contextuel : un mot qui peut apparaître incidemment. */
  LIKELY: 0.75,
  /** Trop faible pour écrire la colonne canonique — la proposition est conservée. */
  INSUFFICIENT: 0.4,
} as const;

/**
 * RÈGLE 8 — le seuil d'écriture. En dessous, `Job.contract` reste VIDE et la
 * proposition ne vit que dans `enrichment`.
 *
 * « Mieux vaut null qu'une mauvaise donnée » : un filtre contrat qui ment coûte
 * plus cher au candidat qu'un filtre incomplet.
 */
export const WRITE_THRESHOLD = CONFIDENCE.LIKELY;

/**
 * La trace d'UN champ enrichi.
 *
 * RÈGLE 6 — `raw` ne duplique PAS le payload : il porte uniquement la valeur
 * qui a servi à la décision, et `sourcePath` dit où elle a été lue. Le payload
 * complet vit déjà dans `Job.raw`.
 */
export type FieldEnrichment<T extends string = string> = {
  /** La valeur exacte ayant fondé la décision — jamais une copie du payload. */
  raw?: string;
  /** La valeur canonique retenue, ou `null` si rien n'a pu être conclu. */
  normalized: T | null;
  method: EnrichmentMethod;
  /** 0 → 1, selon la convention CONFIDENCE. */
  confidence: number;
  /** « contract-v1 » : ce qui permet de savoir quoi rejouer. */
  normalizerVersion: string;
  /** Où la valeur a été lue dans le payload (« bulletFields[2] »). */
  sourcePath?: string;
};

/** Le document `enrichment` stocké en JSONB sur `Job`. */
export type Enrichment = {
  /** Version du CONTENANT, distincte des versions de normaliseurs. */
  schemaVersion: 1;
  contract?: FieldEnrichment;
  workTime?: FieldEnrichment;
  country?: FieldEnrichment;
  jobCategory?: FieldEnrichment;
  [field: string]: FieldEnrichment | number | undefined;
};

export const ENRICHMENT_SCHEMA_VERSION = 1 as const;

/**
 * La valeur canonique est-elle écrivable ?
 *
 * Une trace sans valeur, ou sous le seuil, ne touche pas la colonne (règle 8).
 */
export function isWritable(field: FieldEnrichment): boolean {
  return field.normalized !== null && field.confidence >= WRITE_THRESHOLD;
}

/**
 * Une trace verrouillée par une correction humaine ne se rejoue jamais
 * (règle 5).
 */
export function isLocked(field: FieldEnrichment | undefined): boolean {
  return field?.method === 'MANUAL';
}
