import bootstrap from '../../../../packages/db/data/occupations-v1.json' with { type: 'json' };
import { compileOccupationManifest, normalizeOccupationTitle, persistedOccupationDecision, type CompiledOccupationTaxonomy, type PersistedOccupationDecision } from '@catwalks/db/occupations';
import { type ProgramType } from './employment.js';

/** Occupations, families and ranks use an immutable database catalogue.
 * Runtime writers pass the active release; bootstrap helpers remain useful for
 * pure tests. A new synonym is published as data: the release identifier is
 * the only version. Employment programs keep their separate logic. */
// Bootstrap is a versioned data fixture, used by pure legacy helpers/tests only.
// Runtime writes pass the active database release explicitly.
export const BOOTSTRAP_TAXONOMY = compileOccupationManifest(bootstrap);
export const comparableTitle = normalizeOccupationTitle;

/**
 * Ces trois motifs sont le fruit de mois d'observation réelle (WERKSTUDENT,
 * LEHRSTELLE, AZUBI, NEOLAUREAT, BECARI…). Ils ne classent plus une SÉNIORITÉ —
 * les programmes en sont sortis le 2026-09-08 — mais alimentent `programType`,
 * la dimension à laquelle ils appartenaient depuis le début.
 */
const INTERNSHIP_RE = /\bSTAGE\b|STAGIAIRE|STAGAIRE|INTERN(SHIP)?S?\b|TIROCIN|PRACTICAS|PRAKTIK|ESTAGIO|WERKSTUDENT|PLACEMENT (STUDENT|YEAR)|STUDENT PLACEMENT|\bSTUDENT\b|BECARI/;
const APPRENTICESHIP_RE = /ALTERNAN|APPRENTI|APPRENTICE|APPRENTISSAGE|APPRENDIST|\bLEHRE\b|LEHRSTELLE|LEHRLING|AUSBILDUNG|AUSZUBILDEND|AZUBI|\bELEV\b|WORK[- ]STUDY|DUAL(ES)? (STUD|DEGREE)|CONTRAT (DE )?PRO(FESSIONNALISATION)?\b|LEARNERSHIP/;
const GRADUATE_RE = /GRADUATE|\bV\.?I\.?E\.?\b(?! )|\bVIE\b (?:\d|-|MISSION|PROGRAM|CONTRACT|[A-Z]{2,}\b)|TRAINEE|JEUNE\S* DIPLOM|EARLY CAREER|ROTATIONAL|NEOLAUREAT|MANAGEMENT TRAINING PROGRAM|\bMTP\b/;

/** Ce que la taxonomie ÉCRIT sur une offre : la décision persistée, sans les
 * dérivés du moteur (`occupationGroup`, `occupationSpecializations`) qui se
 * relisent depuis le manifeste et n'ont plus de colonne (lot F1, 2026-09-16). */
export type JobClassification = PersistedOccupationDecision & {
  /** Le dispositif nommé par l'intitulé — dimension distincte de la séniorité. */
  programType: ProgramType | null;
};

/**
 * Le DISPOSITIF que nomme un intitulé, ou `null`.
 *
 * Réutilise les motifs multilingues éprouvés ci-dessus. Le plus spécifique
 * gagne : « Graduate Program » et « V.I.E » avant l'alternance, elle-même avant
 * le stage — « Management Trainee Program » est un parcours de jeune diplômé,
 * pas un stage.
 */
export function classifyProgramType(title: string | null | undefined): ProgramType | null {
  const t = comparableTitle(title);
  if (GRADUATE_RE.test(t)) return /\bV\.?I\.?E\.?\b/.test(t) ? 'VIE' : 'GRADUATE_PROGRAM';
  if (APPRENTICESHIP_RE.test(t)) return 'APPRENTICESHIP';
  if (INTERNSHIP_RE.test(t)) return 'INTERNSHIP';
  return null;
}

/** Tout ce que la taxonomie écrit sur une offre, en une passe. */
export function classifyJob(input: {
  title: string | null | undefined;
  department?: string | null;
  description?: string | null;
}, catalogue: CompiledOccupationTaxonomy = BOOTSTRAP_TAXONOMY): JobClassification {
  return {
    ...persistedOccupationDecision(catalogue.classify(input.title, input.department)),
    programType: classifyProgramType(input.title),
  };
}
