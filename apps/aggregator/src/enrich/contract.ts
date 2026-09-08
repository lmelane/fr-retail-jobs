/**
 * Vertical CONTRAT — la référence architecturale du Data Enrichment Engine.
 *
 * Constat qui a lancé le chantier (mesuré en base le 2026-09-08) : 47 760 des
 * 71 575 offres actives (66,7 %) n'ont pas de contrat, et le filtre du site est
 * donc inutilisable sur deux tiers du catalogue. Mais la matière première est
 * DÉJÀ LÀ, dans le `raw` stocké — simplement jamais lue :
 *
 *   Mango    `bulletFields: ["BARCELONA", "Barcelona", "Permanent"]`  → CDI
 *   Tapestry `bulletFields: ["JR13251"]` + Workday                    → à lire
 *   Ulta     `tags1: ["Part Time"]`                                   → temps, PAS un contrat
 *   Pandora  titre « Sales Associate (m/f/d) - Full-time »            → temps, PAS un contrat
 *
 * D'où la valeur du moteur : le gain se récolte SANS re-scraper une seule
 * source (règle 2), en rejouant l'extraction sur ce qui est déjà en base.
 *
 * Ce module ne réinvente PAS la normalisation : `normalizeContract` mappe déjà
 * Permanent/Regular → CDI, Temporary/Fixed-term → CDD, etc., et `extractContract`
 * porte la logique fine titre/description (tokens sûrs partout, tokens ambigus
 * en tête seulement, négations). Le moteur les ORCHESTRE et rend la décision
 * TRAÇABLE : d'où vient la valeur, avec quelle confiance, quelle version.
 */

import { normalizeContract, isWorkingTimeValue, extractContract } from '../normalize/contract.js';
import { CONFIDENCE, type FieldEnrichment } from './types.js';

/**
 * La version du normaliseur de contrat.
 *
 * À incrémenter dès que les RÈGLES changent — c'est ce qui permet de savoir
 * quelles lignes rejouer, et de mesurer l'effet d'un `contract-v1 → v2`.
 */
export const CONTRACT_NORMALIZER_VERSION = 'contract-v1';

/**
 * Les clés de payload qui portent un terme d'emploi, par famille d'ATS.
 *
 * Choisies sur ce que les sources écrivent RÉELLEMENT (mesuré, pas supposé) :
 * `bulletFields` chez Workday (Mango, Tapestry), `tags1..6` chez Phenom/Jibe
 * (Foot Locker, Ulta), `employmentType` en schema.org, `category` chez plusieurs
 * flux RSS. L'ordre n'a pas d'importance : toutes ces clés valent
 * SOURCE_METADATA, et seule une valeur qui NOMME un contrat est retenue.
 */
const METADATA_KEYS = [
  'employmentType',
  'employment_type',
  'contractType',
  'contract_type',
  'bulletFields',
  'category',
  'categories',
  'tags1',
  'tags2',
  'tags3',
  'tags4',
  'tags5',
  'tags6',
  'jobType',
  'job_type',
  'timeType',
] as const;

export type ContractEnrichmentInput = {
  /** Le champ contrat de la source, s'il en fournit un. */
  contract?: string | null;
  title?: string | null;
  description?: string | null;
  /** Le payload brut de la source, tel que stocké dans `Job.raw`. */
  raw?: unknown;
};

/** Une valeur de payload aplatie, avec le chemin où elle a été lue (règle 6). */
type Candidate = { value: string; path: string };

/** Les valeurs textuelles d'une clé de payload, avec leur chemin. */
function candidatesAt(payload: Record<string, unknown>, key: string): Candidate[] {
  const value = payload[key];
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => ({ value: String(entry ?? '').trim(), path: `${key}[${index}]` }))
      .filter((c) => c.value !== '');
  }
  const text = String(value).trim();
  return text ? [{ value: text, path: key }] : [];
}

/**
 * La première valeur du payload qui nomme un CONTRAT.
 *
 * Le garde-fou essentiel : `isWorkingTimeValue` écarte « Part Time » et
 * « Full-time », qui sont des temps de travail. Sans lui, la colonne contrat se
 * remplirait de valeurs fausses sur des dizaines de milliers d'offres Ulta —
 * précisément ce que la règle 8 interdit.
 */
function fromMetadata(raw: unknown): Candidate | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const payload = raw as Record<string, unknown>;

  for (const key of METADATA_KEYS) {
    for (const candidate of candidatesAt(payload, key)) {
      if (isWorkingTimeValue(candidate.value)) continue;
      if (normalizeContract(candidate.value) !== 'UNKNOWN') return candidate;
    }
  }
  return undefined;
}

/**
 * Le contrat de cette offre, avec la preuve de comment on y est arrivé.
 *
 * `undefined` signifie « aucune preuve suffisante » : la colonne canonique
 * reste alors VIDE (règle 8, « mieux vaut null qu'une mauvaise donnée »).
 *
 * L'ordre des tentatives EST la priorité des preuves (règle 4) : une donnée
 * explicite de la source n'est jamais écrasée par une heuristique.
 */
export function enrichContract(input: ContractEnrichmentInput): FieldEnrichment | undefined {
  const base = { normalizerVersion: CONTRACT_NORMALIZER_VERSION };

  // 1. RAW_FIELD — le champ dédié. Un temps de travail mal rangé dans le champ
  //    contrat (« Full-time ») n'est pas un contrat : on le laisse au vertical
  //    workTime plutôt que d'inventer une valeur.
  if (input.contract && !isWorkingTimeValue(input.contract)) {
    const normalized = normalizeContract(input.contract);
    if (normalized !== 'UNKNOWN') {
      return {
        ...base,
        raw: input.contract,
        normalized,
        method: 'RAW_FIELD',
        confidence: CONFIDENCE.CERTAIN,
      };
    }
  }

  // 2. SOURCE_METADATA — la valeur est dans le payload, hors champ dédié.
  //    C'est le gisement principal : le cas Mango.
  const meta = fromMetadata(input.raw);
  if (meta) {
    return {
      ...base,
      raw: meta.value,
      normalized: normalizeContract(meta.value),
      method: 'SOURCE_METADATA',
      confidence: CONFIDENCE.CERTAIN,
      sourcePath: meta.path,
    };
  }

  // 3. TITLE puis 4. DESCRIPTION — l'inférence, déléguée à `extractContract`
  //    qui porte déjà les règles fines (tokens ambigus en tête seulement,
  //    négations). On rejoue le titre seul d'abord pour SAVOIR laquelle des
  //    deux sources a parlé : la méthode doit être exacte, pas approximative.
  const fromTitle = normalizeContract(input.title);
  if (fromTitle !== 'UNKNOWN' && !isWorkingTimeValue(input.title)) {
    return {
      ...base,
      raw: input.title ?? undefined,
      normalized: fromTitle,
      method: 'TITLE',
      confidence: CONFIDENCE.VERY_LIKELY,
    };
  }

  const fromText = extractContract(input.title, input.description);
  if (fromText !== 'UNKNOWN') {
    return {
      ...base,
      normalized: fromText,
      method: 'DESCRIPTION',
      confidence: CONFIDENCE.VERY_LIKELY,
    };
  }

  return undefined;
}
