import { EMPLOYMENT_RAW_KEYS, employmentPathsAt as pathsAt } from '../normalize/employment-evidence.js';
/**
 * LA CHAÎNE DE DÉCISION CANONIQUE — une seule, pour tout le monde.
 *
 *   preuves brutes → extraction → SourceFieldTrust → priorité → dimensions
 *
 * Cette fonction est appelée par l'ingest live, le replay offline, le dry-run et
 * les tests. Il n'existe volontairement PAS de `replayResolve()` /
 * `ingestResolve()` : deux implémentations de la priorité finiraient par
 * diverger, et un correctif qui n'existe que dans le backfill est un correctif
 * temporaire (règle Loïc, 2026-09-08).
 *
 * Invariant : à preuves identiques et version de trust identique,
 * `ingest result == replay result`.
 */

import {
  readEmployment,
  decomposeCompositeCode,
  extractEmployment,
  type Employment,
} from '../normalize/employment.js';
import { precedenceFor, type TrustLevel } from './verdict.js';
import { readScheduleDescription, type WorkSchedule } from '../normalize/schedule.js';
import { OBSERVED_DIMENSIONS, type ObservedDimension } from './contradictions.js';

/**
 * Les clés du payload qui portent une information d'emploi, mesurées en base.
 * Partagées avec l'observatoire : la mesure et la décision doivent regarder
 * exactement les mêmes chemins, sinon un verdict porterait sur un champ que la
 * résolution ne consulte jamais.
 */


/**
 * Les verdicts, indexés par `source path dimension`.
 *
 * Chargés UNE fois par run et résolus en mémoire : à 71 000 offres, une requête
 * par offre serait un N+1 masqué.
 */
export type TrustContext = ReadonlyMap<string, TrustLevel | string>;

/** Ce dont la résolution a besoin — jamais une ligne Prisma, pour rester testable. */
export type JobEvidenceInput = {
  sourceKey: string;
  title: string | null | undefined;
  description?: string | null;
  /** Le champ « contrat » de la source, quand l'adaptateur en expose un. */
  contract?: string | null;
  /** Le champ « temps de travail » de la source. */
  workingTime?: string | null;
  raw?: unknown;
};

/** Comment la valeur a été décidée — la provenance, conservée pour l'audit. */
export type DecisionOrigin =
  | 'STRUCTURED'
  | 'TITLE_EXPLICIT'
  | 'TITLE_INFERRED'
  | 'NO_STRUCTURED_EVIDENCE'
  | 'AMBIGUOUS_STRUCTURED'
  | 'CONFLICTING_EXPLICIT_EVIDENCE';

export type ResolvedDimension = {
  value: string | undefined;
  /** Le verdict du chemin le plus défavorable ayant participé à la décision. */
  trustLevel: TrustLevel | undefined;
  origin: DecisionOrigin;
};

export type ResolvedEmployment = {
  employmentTerm?: string;
  workTime?: string;
  programType?: string;
  engagementType?: string;
  isSeasonal?: true;
  /** Le RYTHME EXIGÉ : FLEXIBLE_AVAILABILITY | EVENINGS_WEEKENDS | NIGHT_SHIFT. */
  workSchedule?: WorkSchedule;
  /** Le libellé source qui a justifié le rythme, conservé tel quel. */
  rawSchedule?: string;
  /** Le détail par dimension, pour la traçabilité (`enrichment`). */
  decisions: Partial<Record<ObservedDimension, ResolvedDimension>>;
};

/** Les valeurs textuelles d'une clé, avec le chemin exact où elles vivent. */

/** Ce qu'une valeur de source dit, tous chemins de lecture confondus. */
function readValue(value: string): Employment {
  return { ...decomposeCompositeCode(value), ...readEmployment(value) };
}

/**
 * Le rang d'un verdict : plus petit = plus défavorable.
 *
 * TRUSTED et INSUFFICIENT_EVIDENCE partagent le même rang parce qu'ils
 * partagent le même comportement — un champ qu'on n'a pas PROUVÉ faux n'est
 * jamais déclassé. C'est ce qui garantit qu'un triplet sous le seuil ne peut
 * pas, à lui seul, changer une valeur canonique.
 */
const RANK: Record<string, number> = {
  UNTRUSTED: 0,
  DEGRADED: 1,
  TRUSTED: 2,
  INSUFFICIENT_EVIDENCE: 2,
};

/**
 * Résout UNE dimension : quelle preuve gagne, et pourquoi.
 *
 * L'ordre vient de `precedenceFor`, unique source de vérité de la priorité.
 */
function resolveDimension(
  input: JobEvidenceInput,
  dim: ObservedDimension,
  trust: TrustContext,
  titleRead: Employment,
): ResolvedDimension {
  const fromTitle = titleRead[dim] as string | undefined;
  /**
   * La NATURE de la preuve du titre. Seul `workTime` porte aujourd'hui la
   * distinction (« Part-Time » déclaré vs « 21h » déduit) ; ailleurs, un mot de
   * contrat dans un intitulé est toujours explicite.
   */
  const titleKind: 'TITLE_EXPLICIT' | 'TITLE_INFERRED' =
    dim === 'workTime' && titleRead.workTimeEvidence === 'INFERRED' ? 'TITLE_INFERRED' : 'TITLE_EXPLICIT';

  // Les preuves structurées : les champs dédiés de l'adaptateur, puis le payload.
  const structured: { value: string; level: TrustLevel | undefined }[] = [];
  const addDirect = (raw: string | null | undefined, path: string) => {
    if (!raw) return;
    const v = readValue(raw)[dim] as string | undefined;
    if (v) structured.push({ value: v, level: trust.get(`${input.sourceKey} ${path} ${dim}`) as TrustLevel | undefined });
  };
  addDirect(input.contract, 'contract');
  addDirect(input.workingTime, 'workingTime');

  const raw = input.raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const payload = raw as Record<string, unknown>;
    for (const key of EMPLOYMENT_RAW_KEYS) {
      for (const { path, value } of pathsAt(payload, key)) {
        const v = readValue(value)[dim] as string | undefined;
        if (v) structured.push({ value: v, level: trust.get(`${input.sourceKey} ${path} ${dim}`) as TrustLevel | undefined });
      }
    }
  }

  // Aucune preuve structurée : la confiance n'a rien à arbitrer.
  if (structured.length === 0) {
    return { value: fromTitle, trustLevel: undefined, origin: 'NO_STRUCTURED_EVIDENCE' };
  }

  const worst = structured.reduce<TrustLevel>((acc, s) => {
    const lvl = (s.level ?? 'INSUFFICIENT_EVIDENCE') as TrustLevel;
    return RANK[lvl] < RANK[acc] ? lvl : acc;
  }, structured.some(s=>!s.level||s.level==='INSUFFICIENT_EVIDENCE')?'INSUFFICIENT_EVIDENCE':'TRUSTED');

  /**
   * Un champ qui se contredit LUI-MÊME ne tranche rien : `contract_type:
   * ["CDD", "CDI"]` (cas réel) porte deux durées incompatibles. Prendre « la
   * première » serait un tirage au sort. Mieux vaut rien.
   */
  const usableValues = new Set(structured.filter((s) => s.level !== 'UNTRUSTED').map((s) => s.value));
  const ambiguous = usableValues.size > 1;
  const structuredValue = usableValues.size === 1 ? [...usableValues][0] : undefined;
  // A previously unassessed field cannot silently overturn an explicit title.
  // Measured TRUSTED/DEGRADED/UNTRUSTED precedence remains unchanged.
  const literalTitle=readEmployment(input.title)[dim];
  if(worst==='INSUFFICIENT_EVIDENCE' && literalTitle && titleKind==='TITLE_EXPLICIT' && structuredValue && literalTitle!==structuredValue){
    return {value:undefined,trustLevel:worst,origin:'CONFLICTING_EXPLICIT_EVIDENCE'};
  }


  for (const kind of precedenceFor(worst)) {
    if (kind === 'STRUCTURED') {
      if (ambiguous) return { value: undefined, trustLevel: worst, origin: 'AMBIGUOUS_STRUCTURED' };
      if (structuredValue) return { value: structuredValue, trustLevel: worst, origin: 'STRUCTURED' };
    }
    // L'étape ne consomme le titre que si sa NATURE correspond : c'est ce qui
    // fait qu'une inférence passe après un champ seulement DEGRADED.
    if ((kind === 'TITLE_EXPLICIT' || kind === 'TITLE_INFERRED') && kind === titleKind && fromTitle) {
      return { value: fromTitle, trustLevel: worst, origin: titleKind };
    }
  }
  return { value: undefined, trustLevel: worst, origin: 'STRUCTURED' };
}

/**
 * Les dimensions canoniques d'une offre, décidées par les preuves disponibles
 * et ce qu'on sait de leur fiabilité.
 *
 * `trust` vide = comportement par défaut (`structured > title > description`) :
 * un ingest doit fonctionner même si la table de confiance n'a jamais été
 * remplie, jamais échouer.
 */
export function resolveCanonicalDimensions(
  input: JobEvidenceInput,
  trust: TrustContext = new Map(),
): ResolvedEmployment {
  const titleRead = extractEmployment(input.title, input.description);
  const out: ResolvedEmployment = { decisions: {} };

  for (const dim of OBSERVED_DIMENSIONS) {
    const decision = resolveDimension(input, dim, trust, titleRead);
    out.decisions[dim] = decision;
    if (decision.value) (out as Record<string, unknown>)[dim] = decision.value;
  }

  /**
   * `isSeasonal` n'entre dans aucun arbitrage : « CDD » et « saisonnier » sont
   * deux faits vrais simultanément, donc aucune preuve n'en écrase une autre.
   * Il suffit qu'UNE preuve le déclare.
   */
  const seasonalFrom = [
    readEmployment(input.contract),
    readEmployment(input.workingTime),
    titleRead,
  ];
  const raw = input.raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const payload = raw as Record<string, unknown>;
    for (const key of EMPLOYMENT_RAW_KEYS) {
      for (const { value } of pathsAt(payload, key)) seasonalFrom.push(readValue(value));
    }
  }
  if (seasonalFrom.some((e) => e.isSeasonal)) out.isSeasonal = true;

  /**
   * LE RYTHME DE TRAVAIL — lu dans la DESCRIPTION seulement, et c'est délibéré.
   *
   * Aucun chemin structuré n'est consulté parce qu'aucun n'existe : le seul
   * champ `schedule` mesuré en base (186 offres) contient « full-or-part-time »,
   * donc un TEMPS de travail, pas un rythme. Le brancher ici écrirait un
   * volume horaire dans une colonne de rythme.
   *
   * Le libellé source part avec la valeur : sans lui, on ne peut plus dire
   * POURQUOI une offre a été classée NIGHT_SHIFT sans rejouer le normaliseur.
   */
  const schedule = readScheduleDescription(input.description);
  if (schedule) {
    out.workSchedule = schedule.schedule;
    out.rawSchedule = schedule.raw;
  }

  return out;
}

export { EMPLOYMENT_RAW_KEYS } from '../normalize/employment-evidence.js';
