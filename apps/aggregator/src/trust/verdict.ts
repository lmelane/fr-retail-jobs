/**
 * LE VERDICT — une règle DÉTERMINISTE, jamais une note posée à la main.
 *
 * Règle posée par Loïc (2026-09-08) : pas de `reliability = 0.73` dont personne
 * ne saura expliquer la calibration. Quatre états, calculés depuis le volume
 * d'observations, le taux de contradiction et la fraîcheur.
 *
 * Le grain est toujours `source × chemin × dimension` : le champ
 * `employmentType` de PVH peut être faux pour `workTime` sans que PVH — ni même
 * ce champ — soit mauvais pour autre chose.
 */

import type { Observation } from './contradictions.js';
export { EVALUATOR_VERSION } from './contradictions.js';

export const TRUST_LEVELS = ['TRUSTED', 'DEGRADED', 'UNTRUSTED', 'INSUFFICIENT_EVIDENCE'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

/**
 * Sous ce nombre d'observations COMPARABLES, on ne juge pas.
 *
 * « 20 contradictions sur 25 observations » et « 20 sur 10 000 » n'ont pas le
 * même sens : sans plancher, une source qui publie trois offres serait
 * condamnée par un seul titre mal rédigé.
 */
export const MIN_EVIDENCE = 30;

/**
 * Un champ qui se trompe plus d'une fois sur trois n'est pas une source de
 * vérité : on l'écarte. En dessous de 10 %, le désaccord relève du bruit normal
 * (un titre qui dit autre chose que le champ arrive légitimement).
 */
export const UNTRUSTED_RATE = 0.34;
export const DEGRADED_RATE = 0.1;

/**
 * Au-delà de ce silence, une observation ne dit plus rien de l'état ACTUEL du
 * flux : une source peut avoir réparé le sien. Le verdict retombe alors à
 * « pas assez de preuve », jamais à une condamnation à vie.
 */
export const STALE_DAYS = 60;

export type Verdict = {
  source: string;
  path: string;
  dimension: string;
  level: TrustLevel;
  /** Le nombre d'observations comparables — le dénominateur, pas le total. */
  evidenceCount: number;
  contradictionRate: number;
  /** La phrase qui explique le verdict, lisible sans relire le code. */
  reason: string;
  lastObservedAt: Date | null;
  evaluatorVersion: string;
};

/**
 * Le niveau de confiance d'un triplet, et la raison de ce niveau.
 *
 * `now` est injecté pour que la fraîcheur soit testable sans horloge réelle.
 */
export function evaluate(o: Observation, evaluatorVersion: string, now = new Date()): Verdict {
  const base = {
    source: o.source,
    path: o.path,
    dimension: o.dimension,
    evidenceCount: o.comparable,
    contradictionRate: o.contradictionRate,
    lastObservedAt: o.lastObservedAt,
    evaluatorVersion,
  };

  if (o.comparable < MIN_EVIDENCE) {
    return {
      ...base,
      level: 'INSUFFICIENT_EVIDENCE',
      reason: `${o.comparable} observations comparables, minimum ${MIN_EVIDENCE}`,
    };
  }

  const ageDays = o.lastObservedAt
    ? (now.getTime() - o.lastObservedAt.getTime()) / 86_400_000
    : Number.POSITIVE_INFINITY;
  if (ageDays > STALE_DAYS) {
    return {
      ...base,
      level: 'INSUFFICIENT_EVIDENCE',
      reason: `dernière observation il y a ${Math.round(ageDays)} jours (> ${STALE_DAYS}) — le flux a pu changer`,
    };
  }

  const pct = (o.contradictionRate * 100).toFixed(1);
  if (o.contradictionRate >= UNTRUSTED_RATE) {
    return {
      ...base,
      level: 'UNTRUSTED',
      reason: `${o.contradictions} contradictions sur ${o.comparable} observations (${pct} %)`,
    };
  }
  if (o.contradictionRate >= DEGRADED_RATE) {
    return {
      ...base,
      level: 'DEGRADED',
      reason: `${o.contradictions} contradictions sur ${o.comparable} observations (${pct} %)`,
    };
  }
  return {
    ...base,
    level: 'TRUSTED',
    reason: `${o.contradictions} contradictions sur ${o.comparable} observations (${pct} %)`,
  };
}

/**
 * L'ordre des preuves pour UNE dimension, selon ce qu'on sait du champ.
 *
 * Comportement normal : le champ structuré d'abord, puis le titre, puis le
 * texte. Quand ce champ est DÉMONTRÉ faux pour cette dimension, il est ÉCARTÉ —
 * pas simplement pondéré : une preuve connue comme fausse ne doit pas pouvoir
 * l'emporter par accident de configuration.
 *
 * DEGRADED reste utilisable mais passe APRÈS le titre : le doute profite au
 * contre-témoin sans jeter une information encore majoritairement juste.
 */
export type EvidenceKind = 'STRUCTURED' | 'TITLE_EXPLICIT' | 'TITLE_INFERRED' | 'DESCRIPTION';

/**
 * L'ordre des preuves — et le SPLIT du titre a une conséquence réelle.
 *
 * « Sales Associate - Part-Time » DÉCLARE le rythme ; « Conseiller de vente
 * 21h » le laisse DÉDUIRE. Un titre explicite peut détrôner un champ structuré
 * seulement DEGRADED ; une inférence, non — elle passe APRÈS lui. Sans cette
 * distinction, on aurait ajouté de la traçabilité sans en tirer la conséquence
 * logique (décision Loïc, 2026-09-08).
 */
export function precedenceFor(level: TrustLevel | undefined): EvidenceKind[] {
  switch (level) {
    case 'UNTRUSTED':
      // Le champ est écarté : on ne le consulte même pas en dernier recours.
      return ['TITLE_EXPLICIT', 'TITLE_INFERRED', 'DESCRIPTION'];
    case 'DEGRADED':
      // Un mot déclaré passe devant un champ douteux ; une déduction, non.
      return ['TITLE_EXPLICIT', 'STRUCTURED', 'TITLE_INFERRED', 'DESCRIPTION'];
    // TRUSTED, INSUFFICIENT_EVIDENCE et l'absence de verdict partagent le
    // comportement par défaut : rien ne justifie de déclasser un champ qu'on
    // n'a pas prouvé faux.
    default:
      return ['STRUCTURED', 'TITLE_EXPLICIT', 'TITLE_INFERRED', 'DESCRIPTION'];
  }
}
