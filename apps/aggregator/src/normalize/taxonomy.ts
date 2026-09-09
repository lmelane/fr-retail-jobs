import bootstrap from '../../../../packages/db/data/occupations-v1.json' with { type: 'json' };
import { compileOccupationManifest, normalizeOccupationTitle, type CompiledOccupationTaxonomy, type OccupationDecision } from '@catwalks/db/occupations';
import { readEmployment, type ProgramType } from './employment.js';
import { extractSkills } from './skills.js';

/** Occupations, families and ranks use an immutable database catalogue.
 * Runtime writers pass the active release; bootstrap helpers remain useful for
 * pure tests. A new synonym is published as data, not a TAXONOMY_VERSION bump.
 * AI, skills and employment programs retain their separate existing logic. */
export const TAXONOMY_VERSION = 4;
export type JobFamily = string;
export type JobFunction = string;
export type Seniority = string;
export type FunctionDefinition = { key: string; label: string; family: string };
// Bootstrap is a versioned data fixture, used by pure legacy helpers/tests only.
// Runtime writes pass the active database release explicitly.
export const BOOTSTRAP_TAXONOMY = compileOccupationManifest(bootstrap);
export const JOB_FUNCTIONS: ReadonlyArray<FunctionDefinition> = bootstrap.families.map(f => ({ key: f.key, label: f.labels.fr, family: f.group }));
export const SENIORITY_LABELS: Readonly<Record<string,string>> = Object.fromEntries(bootstrap.seniorities.map(s => [s.key,s.labels.fr]));
export const comparableTitle = normalizeOccupationTitle;
export function classifyFunction(title: string | null | undefined, department?: string | null): string | null {
  return BOOTSTRAP_TAXONOMY.classify(title,department).jobFunction;
}
export function familyOf(key: string | null | undefined): string | null {
  return key ? BOOTSTRAP_TAXONOMY.families.get(key)?.group ?? null : null;
}

/**
 * Ces trois motifs sont le fruit de mois d'observation réelle (WERKSTUDENT,
 * LEHRSTELLE, AZUBI, NEOLAUREAT, BECARI…). Ils ne classent plus une SÉNIORITÉ —
 * les programmes en sont sortis le 2026-09-08 — mais alimentent `programType`,
 * la dimension à laquelle ils appartenaient depuis le début.
 */
const INTERNSHIP_RE = /\bSTAGE\b|STAGIAIRE|STAGAIRE|INTERN(SHIP)?S?\b|TIROCIN|PRACTICAS|PRAKTIK|ESTAGIO|WERKSTUDENT|PLACEMENT (STUDENT|YEAR)|STUDENT PLACEMENT|\bSTUDENT\b|BECARI/;
const APPRENTICESHIP_RE = /ALTERNAN|APPRENTI|APPRENTICE|APPRENTISSAGE|APPRENDIST|\bLEHRE\b|LEHRSTELLE|LEHRLING|AUSBILDUNG|AUSZUBILDEND|AZUBI|\bELEV\b|WORK[- ]STUDY|DUAL(ES)? (STUD|DEGREE)|CONTRAT (DE )?PRO(FESSIONNALISATION)?\b|LEARNERSHIP/;
const GRADUATE_RE = /GRADUATE|\bV\.?I\.?E\.?\b(?! )|\bVIE\b (?:\d|-|MISSION|PROGRAM|CONTRACT|[A-Z]{2,}\b)|TRAINEE|JEUNE\S* DIPLOM|EARLY CAREER|ROTATIONAL|NEOLAUREAT|MANAGEMENT TRAINING PROGRAM|\bMTP\b/;
export function classifySeniority(title: string | null | undefined, department?: string | null): string | null {
  return BOOTSTRAP_TAXONOMY.classify(title,department).seniority;
}

/**
 * L'annonce parle-t-elle d'IA ? Sigles en capitales strictes — « AI » et
 * « IA » en minuscules sont des mots français — plus les expressions longues,
 * toutes langues. Avant le test, on retire ce qui n'est pas un métier :
 * les phrases de PROCESSUS de recrutement, les clauses d'entreprise, le code
 * de l'Iowa (« Altoona, IA, USA »), la saison « AI 2027 » (Autunno-Inverno).
 */
const AI_ACRONYM_RE = /(?<![''’])\b(?:AI|IA|GENAI|LLMS?|NLP)\b(?![-']?\w)/;
const AI_PHRASE_RE = /artificial intelligence|intelligence artificielle|intelligenza artificiale|inteligencia artificial|k[üu]nstliche intelligenz|machine learning|apprentissage (automatique|machine)|deep learning|generative ai|gen ?ai\b|ia g[ée]n[ée]rative|large language model|computer vision|prompt engineer|chatgpt|openai|neural network|r[ée]seaux? de neurones/i;
/** « data science » compte hors intitulé de diplôme et hors nom d'équipe. */
const DATA_SCIENCE_RE = /data scien/gi;
const DEGREE_CONTEXT_RE = /degree|master|bachelor|b\.?sc|m\.?sc|dipl[oô]m|formation|studies|laurea|[ée]tudiant|background in|analysts?,|scientists,/i;

/**
 * Phrases qui parlent du PROCESSUS de recrutement ou de l'entreprise, pas du
 * poste : « refrain from using AI tools during interviews », « artificial
 * intelligence is not used for hiring decisions », « AI at Toast », « We do
 * not employ machine learning technologies during this phase », « L'IA peut
 * être utilisée à des fins de présélection », « Charte IA : notre pacte ».
 * Mesuré en prod (audit I-3) : 41 % des offres « IA » l'étaient par une de
 * ces phrases recopiées dans chaque annonce d'une société.
 */
const PROCESS_SENTENCE_RE = /interview|entretien|recruit|recrut|hiring (process|decision|team|manager)|selection process|processus de (s[ée]lection|recrutement)|pr[ée]s[ée]lection|screening|candidat|applicant|application(s)? (process|form|will|are|is)|assessment|fraud|scam|privacy|data protection|personal (data|information)|donn[ée]es personnelles|equal (opportunit|employment)|discriminat|accommodation|inteligencia artificial.{0,60}(entrevista|proceso)|refrain|abstenga|prohibit|not permitted|is not used|n'est pas utilis|sans utiliser|ne pas utiliser|do not (employ|use)|train(ing)? (any )?(AI|ML) models|disclos|consent|GDPR|RGPD|Bewerbung|Auswahl|at (toast|infuse)|we (use|leverage|believe|handle|build)|our (mission|pact|values|technology|proprietary)|company values|charte IA|AI charter|notre pacte|founded in|proprietary technology|about (us|the company)|who we are|à propos de/i;

/** Ce qui ressemble à un sigle IA sans en être un : le code de l'Iowa, la saison italienne. */
function stripFalseAcronyms(text: string): string {
  return text
    .replace(/,\s*IA(,|\s+USA|\s+US\b|\s+\d{5})/g, ' ')
    .replace(/\b(?:AI|PE)\s?\/\s?(?:AI|PE)\b|\b(?:SS|AI|PE)\s?\/\s?(?:AI|PE)\s?\d{2,4}|\bAI\s?20\d\d\b|\bAI\s?\d\d\b/g, ' ');
}

export function isAiRelated(title: string | null | undefined, description?: string | null): boolean {
  const body = stripFalseAcronyms((description ?? '').slice(0, 30_000))
    .split(/(?<=[.!?])\s+|\n+|\s[•·▪●-]\s/)
    .filter((sentence) => !PROCESS_SENTENCE_RE.test(sentence))
    .join('\n');
  const text = `${stripFalseAcronyms(title ?? '')}\n${body}`;
  if (AI_PHRASE_RE.test(text) || AI_ACRONYM_RE.test(text)) return true;
  DATA_SCIENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DATA_SCIENCE_RE.exec(text)) !== null) {
    const window = text.slice(Math.max(0, match.index - 45), match.index + match[0].length + 45);
    if (!DEGREE_CONTEXT_RE.test(window)) return true;
  }
  return false;
}

/** Les mots d'IA dans un TITRE : la garde par société ne conserve que ceux-là. */
export const AI_TITLE_RE = /\b(?:AI|IA|ML|GENAI|LLM|NLP)\b|MACHINE LEARNING|ARTIFICIAL INTELLIGENCE|INTELLIGENCE ARTIFICIELLE|DATA SCIEN|DEEP LEARNING|COMPUTER VISION|PROMPT/;

export type JobClassification = OccupationDecision & {
  isAiRelated: boolean;
  skills: string[];
  taxonomyVersion: number;
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
  const decision = catalogue.classify(input.title, input.department);
  return {
    ...decision,
    programType: classifyProgramType(input.title),
    isAiRelated: isAiRelated(input.title, input.description),
    skills: extractSkills(`${input.title ?? ''}\n${input.description ?? ''}`),
    taxonomyVersion: TAXONOMY_VERSION,
  };
}
