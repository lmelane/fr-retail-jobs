/**
 * LA GARDE DES 5 % — le seuil global de fermetures, et l'unique façon d'y déroger.
 *
 * Constat qui a rendu ce module nécessaire (P7, 2026-09-12) : `closureRatioWithinFivePercent` était CALCULÉ et
 * AFFICHÉ par la prévisualisation, mais lu par aucun code. Ce n'était donc pas une garde — c'était un
 * indicateur, et personne ne pouvait le savoir en lisant le rapport. Une garde qu'aucun chemin d'exécution ne
 * consulte protège exactement rien.
 *
 * La politique du propriétaire, telle qu'elle a été arbitrée :
 *  · le seuil global de 5 % reste inchangé ;
 *  · une dérogation est possible UNIQUEMENT pour un manifeste explicitement revu et approuvé ;
 *  · on ne fractionne jamais une opération pour produire plusieurs ratios sous le seuil.
 *
 * DEUX PRÉCISIONS QUI CHANGENT LE RÉSULTAT, et qui ne sont pas des détails :
 *
 * 1. On compte des FERMETURES D'OFFRE, pas des désactivations de représentation. Désactiver la représentation
 *    d'une source alors qu'une autre source atteste encore l'offre ne ferme rien pour le candidat : l'offre
 *    reste visible et postulable. Les compter gonflerait le ratio et ferait refuser des opérations inoffensives.
 *
 * 2. Le dénominateur est le PÉRIMÈTRE RECEVABLE — les représentations actives des sources qui peuvent prouver
 *    une absence — et il est transporté dans le verdict pour être relu. Un ratio sans son dénominateur écrit
 *    n'est pas vérifiable, et c'est par le dénominateur qu'on truque un ratio sans mentir sur le numérateur.
 */
import { createHash } from 'node:crypto';

/** La dérogation propriétaire : elle nomme ce qui est approuvé, jamais « cette source » en général. */
export type OwnerWaiver = {
  /** L'empreinte EXACTE du plan approuvé. Un plan régénéré a une autre empreinte, donc n'est pas couvert. */
  planHash: string;
  /** Les sources nommées dans la décision. */
  sourceKeys: string[];
  /** Les identifiants approuvés, un par un — jamais un motif ni un préfixe. */
  approvedExternalIds: string[];
  /** La conséquence approuvée pour chaque identifiant : la changer après coup invalide la dérogation. */
  approvedConsequences: Record<string, 'JOB_CANDIDATE_FOR_CLOSURE' | 'JOB_KEPT_BY_ANOTHER_SOURCE'>;
  /** Où la décision est archivée — une dérogation sans trace n'en est pas une. */
  decisionReference: string;
};

export type ClosurePlanEntry = {
  sourceKey: string;
  externalId: string;
  jobId: string;
  consequence: 'JOB_CANDIDATE_FOR_CLOSURE' | 'JOB_KEPT_BY_ANOTHER_SOURCE';
};

export type ClosureRatioVerdict = {
  allowed: boolean;
  /** Fermetures d'OFFRE (Job distincts), jamais les désactivations de représentation. */
  jobClosures: number;
  /** Le périmètre recevable, écrit pour être relu. */
  denominator: number;
  ratioPct: number;
  withinThreshold: boolean;
  thresholdPct: number;
  waiverApplied: boolean;
  reasons: string[];
};

export const CLOSURE_RATIO_THRESHOLD_PCT = 5;

/** L'empreinte de la dérogation : ce qu'elle approuve, trié, sans son enrobage. */
export function waiverHash(waiver: OwnerWaiver): string {
  const canonical = {
    planHash: waiver.planHash,
    sourceKeys: [...waiver.sourceKeys].sort(),
    ids: [...waiver.approvedExternalIds].sort(),
    consequences: Object.fromEntries(Object.entries(waiver.approvedConsequences).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Le plan est-il autorisé à muter ?
 *
 * L'ordre des contrôles est délibéré : sous le seuil, une dérogation est inutile et n'est pas exigée ; au-dessus,
 * elle doit couvrir le plan EXACTEMENT — même empreinte, mêmes sources, mêmes identifiants, mêmes conséquences.
 */
export function evaluateClosureRatio(
  entries: readonly ClosurePlanEntry[],
  denominator: number,
  planHash: string,
  waiver?: OwnerWaiver | null,
  thresholdPct: number = CLOSURE_RATIO_THRESHOLD_PCT,
): ClosureRatioVerdict {
  const reasons: string[] = [];

  // Une offre conservée par une autre source n'est PAS une fermeture : le candidat la voit toujours.
  const closingJobIds = new Set(
    entries.filter((e) => e.consequence === 'JOB_CANDIDATE_FOR_CLOSURE').map((e) => e.jobId),
  );
  const jobClosures = closingJobIds.size;

  if (denominator <= 0) {
    return {
      allowed: false, jobClosures, denominator, ratioPct: 0, withinThreshold: false,
      thresholdPct, waiverApplied: false,
      reasons: ['dénominateur nul ou négatif : le ratio n\'est pas calculable, on ne mute pas sur un ratio inconnu'],
    };
  }

  const ratioPct = Number(((jobClosures / denominator) * 100).toFixed(2));
  const withinThreshold = jobClosures / denominator <= thresholdPct / 100;

  if (withinThreshold) {
    return { allowed: true, jobClosures, denominator, ratioPct, withinThreshold, thresholdPct, waiverApplied: false, reasons };
  }

  // Au-dessus du seuil : seule une dérogation exacte peut autoriser, et elle ne dispense d'aucune autre garde.
  if (!waiver) {
    reasons.push(`ratio de fermeture ${ratioPct} % > ${thresholdPct} % et aucune dérogation propriétaire : refus avant mutation`);
    return { allowed: false, jobClosures, denominator, ratioPct, withinThreshold, thresholdPct, waiverApplied: false, reasons };
  }

  if (waiver.planHash !== planHash) {
    reasons.push(`la dérogation porte sur le plan ${waiver.planHash.slice(0, 12)}, le plan présenté est ${planHash.slice(0, 12)} : plan régénéré ou modifié`);
  }
  if (!waiver.decisionReference?.trim()) {
    reasons.push('dérogation sans référence de décision archivée');
  }

  const approved = new Set(waiver.approvedExternalIds);
  const allowedSources = new Set(waiver.sourceKeys);
  for (const e of entries) {
    if (!allowedSources.has(e.sourceKey)) {
      reasons.push(`source hors dérogation : ${e.sourceKey}`);
      continue;
    }
    if (!approved.has(e.externalId)) {
      reasons.push(`identifiant NON approuvé présent au plan : ${e.sourceKey}/${e.externalId}`);
      continue;
    }
    const expected = waiver.approvedConsequences[e.externalId];
    if (expected && expected !== e.consequence) {
      reasons.push(`conséquence modifiée après approbation : ${e.externalId} approuvé ${expected}, plan ${e.consequence}`);
    }
  }

  // Un plan RÉDUIT n'est pas couvert non plus : le propriétaire a revu un ensemble, pas un sous-ensemble
  // quelconque de celui-ci — et un sous-ensemble est exactement la façon de fractionner pour passer sous 5 %.
  const planned = new Set(entries.map((e) => e.externalId));
  const missing = waiver.approvedExternalIds.filter((id) => !planned.has(id));
  if (missing.length) {
    reasons.push(`plan réduit par rapport à la dérogation : ${missing.length} identifiant(s) approuvé(s) absent(s) — `
      + `fractionner une opération pour passer sous le seuil est explicitement interdit (${missing.slice(0, 5).join(', ')})`);
  }

  return {
    allowed: reasons.length === 0, jobClosures, denominator, ratioPct, withinThreshold,
    thresholdPct, waiverApplied: reasons.length === 0, reasons,
  };
}
