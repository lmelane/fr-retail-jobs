/**
 * LE VERDICT TERMINAL D'UN PASSAGE DE CAPACITÉ — le succès du wrapper n'est pas celui du travail.
 *
 * Défaut mesuré le 2026-09-13 : le runner a annoncé `problems: []`, `CODE_SORTIE=0` et « terminé », alors que
 * le `PipelineRun` sous-jacent valait **INTERRUPTED** — tué par un déploiement déclenché pendant le run. Le
 * wrapper disait vrai sur SA chaîne (préflight, exécution, restauration) et faux sur le travail piloté.
 *
 * C'est la même famille d'erreur que le tube qui masquait un code de sortie : une couche de présentation qui
 * répond à la place de la couche mesurée. Ici la conséquence est pire — une mesure de capacité tronquée à
 * 88,8 s d'un run de quinze minutes serait entrée dans une moyenne comme si elle valait les autres.
 *
 * Règle : pour un passage de capacité, SEUL un statut terminal sain autorise `exit 0`. Tout le reste — y
 * compris « je n'ai pas trouvé le run » — est non recevable, parce qu'une mesure qu'on ne peut pas rattacher
 * à un run terminé n'est pas une mesure.
 */

export type PipelineRunStatus =
  | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'INTERRUPTED' | 'FAILED' | 'RUNNING' | null;

export type SourceRunFact = {
  sourceKey: string;
  status: string | null;
  complete: boolean | null;
  truncated: boolean | null;
  errors: number | null;
};

export type CapacityVerdict = {
  /** Recevable comme MESURE de capacité — plus strict que « le run a tourné ». */
  validForCapacity: boolean;
  pipelineRunStatus: PipelineRunStatus;
  invalidatedReason: string | null;
  problems: string[];
  exitCode: number;
};

/**
 * Les codes de problème sont NOMMÉS et stables : un rapport qui dit « problème » sans le qualifier oblige à
 * relire les journaux, et un incident qu'on ne peut pas classer ne se compte pas.
 */
export const PROBLEM = {
  INTERRUPTED: 'PIPELINE_RUN_INTERRUPTED',
  FAILED: 'PIPELINE_RUN_FAILED',
  NOT_TERMINAL: 'PIPELINE_RUN_NOT_TERMINAL',
  NOT_FOUND: 'PIPELINE_RUN_NOT_FOUND',
  SOURCE_INCOMPLETE: 'SOURCE_RUN_FAILED_OR_INCOMPLETE',
  WITH_ERRORS: 'PIPELINE_RUN_COMPLETED_WITH_ERRORS',
} as const;

/**
 * Le verdict d'un passage de capacité.
 *
 * `allowWithErrors` n'existe que pour une politique EXPLICITE et documentée qui exclurait par ailleurs le
 * passage du corpus ; par défaut un run « terminé avec erreurs » n'est pas une mesure de capacité, parce
 * qu'on ne sait pas ce que les erreurs ont coûté en temps et en volume.
 */
export function capacityVerdict(input: {
  status: PipelineRunStatus;
  runFound: boolean;
  sourceRuns?: readonly SourceRunFact[];
  environmentProblems?: readonly string[];
  allowWithErrors?: boolean;
}): CapacityVerdict {
  const problems: string[] = [...(input.environmentProblems ?? [])];
  let invalidatedReason: string | null = null;

  if (!input.runFound) {
    problems.push(PROBLEM.NOT_FOUND);
    invalidatedReason = 'RUN_NOT_FOUND';
  } else {
    switch (input.status) {
      case 'COMPLETED':
        break;
      case 'COMPLETED_WITH_ERRORS':
        if (!input.allowWithErrors) {
          problems.push(PROBLEM.WITH_ERRORS);
          invalidatedReason = 'COMPLETED_WITH_ERRORS';
        }
        break;
      case 'INTERRUPTED':
        problems.push(PROBLEM.INTERRUPTED);
        invalidatedReason = 'INTERRUPTED';
        break;
      case 'FAILED':
        problems.push(PROBLEM.FAILED);
        invalidatedReason = 'FAILED';
        break;
      case 'RUNNING':
      case null:
      default:
        // Un run encore en vol n'est pas un run terminé : la mesure porterait sur un état qui bouge encore.
        problems.push(PROBLEM.NOT_TERMINAL);
        invalidatedReason = 'NOT_TERMINAL';
        break;
    }
  }

  /**
   * Une source tronquée ou incomplète invalide le passage : le corpus figé n'a pas été parcouru, donc le débit
   * mesuré porte sur autre chose que ce qu'on annonce. C'est exactement ce qui rendait le T2 interrompu
   * inexploitable — `knitwell-us-retail` et `nordstrom` s'étaient arrêtés en route.
   */
  for (const s of input.sourceRuns ?? []) {
    const bad = s.truncated === true || s.complete === false || (s.errors ?? 0) > 0
      || (s.status != null && !['OK', 'DEGRADED', 'NEW'].includes(s.status));
    if (bad) {
      problems.push(`${PROBLEM.SOURCE_INCOMPLETE}:${s.sourceKey}`);
      invalidatedReason ??= 'SOURCE_INCOMPLETE';
    }
  }

  const validForCapacity = problems.length === 0;
  return {
    validForCapacity,
    pipelineRunStatus: input.runFound ? input.status : null,
    invalidatedReason,
    problems,
    exitCode: validForCapacity ? 0 : 1,
  };
}
