/**
 * LES QUATRE DIMENSIONS D'EMPLOI — modèle mondial, dimensions indépendantes.
 *
 * Ce module remplace `normalize/contract.ts`. Deux erreurs de modélisation
 * successives, toutes deux MESURÉES dans cette base, l'ont rendu nécessaire :
 *
 *  1. `contract` imposait une grille juridique FRANÇAISE (CDI/CDD/STAGE) à un
 *     catalogue mondial, et mélangeait quatre concepts dans un champ unique :
 *     une DURÉE (permanent), un RYTHME (full-time), une RELATION JURIDIQUE
 *     (independent contractor) et un PROGRAMME (stage, V.I.E).
 *  2. `seniority` était contaminé par ces mêmes programmes : INTERNSHIP 3 438,
 *     APPRENTICESHIP 658, GRADUATE 200 — ce ne sont pas des niveaux.
 *
 * La preuve mesurée que quatre dimensions sont nécessaires : `employment_type_code`
 * sert `parttime_fixed_term` (225 offres), `fulltime_permanent` (154) — des
 * valeurs qui portent DEUX dimensions à la fois. Un champ unique devait en
 * écraser une.
 *
 * RÈGLE (Loïc, 2026-09-08) : « le faible volume décide si on EXPOSE une
 * dimension, pas si on POLLUE la taxonomie canonique. » `engagementType` ne
 * concerne que 130 offres et reste une colonne nullable propre, sans index ni
 * facette — plutôt qu'une valeur rangée dans la mauvaise dimension.
 *
 * COROLLAIRE, appliqué partout ici : on ne DÉDUIT jamais une dimension d'une
 * autre. Un V.I.E est borné dans le temps, mais tant que la source ne l'écrit
 * pas, `employmentTerm` reste vide. Mieux vaut null qu'une donnée inventée.
 */

/**
 * La DURÉE de la relation.
 *
 * SEASONAL n'y figure PAS, et c'est une correction de modèle mesurée : 2 359
 * offres Sephora portent `contract = CDD` ET un titre « Seasonal Retail
 * Associate ». Les deux informations sont VRAIES en même temps — les opposer
 * dans une même dimension forçait un faux arbitrage (« le titre l'emporte-t-il
 * sur le champ déclaré ? ») et n'aurait laissé que 4 SEASONAL dans tout le
 * catalogue. Le caractère saisonnier est une caractéristique INDÉPENDANTE :
 * voir `isSeasonal`. (Décision Loïc, 2026-09-08.)
 */
export const EMPLOYMENT_TERMS = ['PERMANENT', 'FIXED_TERM', 'TEMPORARY'] as const;
/** Le RYTHME. */
export const WORK_TIMES = ['FULL_TIME', 'PART_TIME'] as const;
/** Le DISPOSITIF, quand l'offre en est un. */
export const PROGRAM_TYPES = ['INTERNSHIP', 'APPRENTICESHIP', 'GRADUATE_PROGRAM', 'VIE'] as const;
/** La NATURE JURIDIQUE de la relation. `EMPLOYEE` exige une preuve positive. */
export const ENGAGEMENT_TYPES = ['EMPLOYEE', 'FREELANCE', 'INDEPENDENT_CONTRACTOR'] as const;

export type EmploymentTerm = (typeof EMPLOYMENT_TERMS)[number];
export type WorkTime = (typeof WORK_TIMES)[number];
export type ProgramType = (typeof PROGRAM_TYPES)[number];
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

/** Ce qu'une valeur de source dit — chaque dimension est optionnelle et cumulable. */
export type Employment = {
  employmentTerm?: EmploymentTerm;
  workTime?: WorkTime;
  programType?: ProgramType;
  engagementType?: EngagementType;
  /**
   * Le poste est saisonnier. Caractéristique INDÉPENDANTE de la durée : une
   * offre est couramment « CDD » ET « saisonnière », et aucune des deux
   * informations n'écrase l'autre puisqu'elles ne décrivent pas la même chose.
   * `undefined` = la source ne dit rien ; on n'écrit jamais `false` par défaut.
   */
  isSeasonal?: true;
};

/** Accents et casse retirés : les sources écrivent « Intérim », « INTERIM », « interim ». */
function upper(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
}

/**
 * PROGRAMMES — testés en PREMIER, et ils bloquent les autres dimensions.
 *
 * Un « Stagiaire (durée déterminée) » est un stage : le mot le plus spécifique
 * gagne. `(?<!HORS )STAGIAIRE` laisse passer « Contrat à durée déterminée (hors
 * stagiaire) », un vrai CDD où le mot apparaît dans une exclusion — cas réel
 * servi par Workday en français.
 *
 * V.I.E seulement en forme pointée ou en toutes lettres : le mot « vie » nu,
 * une fois en majuscules, attrapait « qualité de vie » et « assurance vie ».
 */
const PROGRAM_PATTERNS: ReadonlyArray<readonly [ProgramType, RegExp]> = [
  /**
   * V.I.E : la forme pointée, le nom complet, ou le sigle NU en tête de libellé
   * suivi d'un séparateur — « VIE - Data Analyst (H/F) - New York », « VIE Data
   * Engineer », tels que les sources les écrivent (mesuré au dry-run : 100 % des
   * V.I.E étaient perdus sans cette forme).
   *
   * La garde reste stricte sur le mot français : « vie » n'est un dispositif que
   * s'il OUVRE le libellé. « Qualité de vie au travail », « assurance vie » et
   * « art de vivre » ne le déclenchent donc jamais.
   */
  ['VIE', /\bV\.I\.E\.?\b|VOLONTARIAT INTERNATIONAL|^VIE\b(?=[ ,:—-])/],
  /**
   * « Management Trainee Programm » (SeedZ, Coty) est un parcours de jeune
   * diplômé, pas un stage : « trainee » seul évoque le stage, mais accompagné de
   * « program » il désigne un graduate program. Testé AVANT la règle stage.
   */
  ['GRADUATE_PROGRAM', /GRADUATE[ _-]?PROGRAM|JEUNE DIPLOME|TRAINEE[ _-]?PROGRAMM?/],
  ['APPRENTICESHIP', /ALTERNANCE|APPRENTISSAGE|APPRENTICE(?:SHIP)?|PROFESSIONNALISATION|WORK[ -]STUDY|AUSBILDUNG/],
  ['INTERNSHIP', /\bSTAGE\b|(?<!HORS )STAGIAIRE|INTERNSHIP|\bINTERN\b|\bTRAINEE\b|PRAKTIKUM|PRACTICAS|TIROCINIO/],
];

/**
 * DURÉE de la relation.
 *
 * `(?<!UN)BEFRISTET` : en allemand « unbefristet » (CDI) CONTIENT « befristet »
 * (CDD) — sans la garde, tout CDI allemand ressortait en durée déterminée.
 *
 * « TEMPORARY » anglophone désigne un contrat à durée déterminée (Eightfold
 * « Fulltime-Temporary »), pas une mission d'intérim : l'intérim, lui, nomme
 * une agence. « MISSION » seul est écarté (Commission, Émission, « Chef de
 * Mission ») ; une vraie mission d'intérim porte le mot « intérim ».
 */
const TERM_PATTERNS: ReadonlyArray<readonly [EmploymentTerm, RegExp]> = [
  ['TEMPORARY', /\bINTERIM\b|INTERIMAIRE|ZERO HEURE|ZERO[ -]HOUR|\bAGENCY WORKER\b|LEIHARBEIT/],
  [
    'FIXED_TERM',
    /\bCDD\b|DUREE DETERMINEE|FIX(?:ED)?[ -]?TERM|CONTRAT TEMPORAIRE|\bTEMPORARY\b|\bTEMP\b|(?<!UN)BEFRISTET|CONTRATO TEMPORAL/,
  ],
  [
    'PERMANENT',
    /\bCDI\b|CONTRAT A DUREE INDETERMINEE|\bPERMANENT\b|\bREGULAR\b|UNBEFRISTET|INDEFINID/,
  ],
];

/**
 * SAISONNIER — caractéristique indépendante, jamais une valeur de durée.
 *
 * « SAISON » nu est écarté : « collection Automne-Hiver », « saison des soldes »
 * et « bilan de saison » sont partout dans ce secteur sans qu'aucun poste ne
 * soit saisonnier. Seuls les mots qui QUALIFIENT le poste comptent.
 */
const SEASONAL_PATTERN = /\bSEASONAL\b|SAISONNIER|SAISONNIERE|SAISONNALIER|TRAVAIL SAISONNIER|SAISONARBEIT/;

/** RYTHME. Un horaire chiffré n'est un temps partiel qu'en dessous de 35 h. */
const WORK_TIME_PATTERNS: ReadonlyArray<readonly [WorkTime, RegExp]> = [
  ['PART_TIME', /PART[ _-]?TIME|TEMPS[ -]PARTIEL|MI[ -]TEMPS|TEILZEIT|兼职|\b(?:[0-2]?\d|3[0-4])\s?H\b/],
  ['FULL_TIME', /FULL[ _-]?TIME|TEMPS[ -]PLEIN|PLEIN[ -]TEMPS|VOLLZEIT|全职|\b3[5-9]\s?H\b/],
];

/**
 * NATURE JURIDIQUE. `CONTRACTOR` (valeur schema.org) désigne un independent
 * contractor au sens américain, une qualification distincte du freelance
 * européen — décision Loïc : les deux restent séparés, le regroupement dans un
 * filtre est une affaire d'UX, pas de modèle.
 *
 * `EMPLOYEE` n'est jamais déduit : aucune source ne le déclare, et le conclure
 * d'une absence de freelance serait inventer une donnée.
 */
const ENGAGEMENT_PATTERNS: ReadonlyArray<readonly [EngagementType, RegExp]> = [
  ['INDEPENDENT_CONTRACTOR', /INDEPENDENT[ -]CONTRACTOR|\bCONTRACTOR\b|\b1099\b/],
  ['FREELANCE', /FREELANCE|\bINDEPENDANT\b|PRESTATAIRE|SELF[ -]EMPLOYED|AUTO[ -]ENTREPRENEUR/],
];

/**
 * Lit une valeur libre de source et renseigne TOUTES les dimensions qu'elle
 * nomme — elles sont cumulables : « CDI 35H » donne le terme ET le rythme.
 *
 * Un programme (stage, alternance, V.I.E) N'IMPLIQUE PAS un terme : la durée
 * n'est renseignée que si la valeur la nomme elle-même.
 */
export function readEmployment(raw?: string | null): Employment {
  if (!raw) return {};
  const value = upper(raw);
  const out: Employment = {};

  for (const [type, pattern] of PROGRAM_PATTERNS) {
    if (pattern.test(value)) { out.programType = type; break; }
  }
  for (const [type, pattern] of TERM_PATTERNS) {
    if (pattern.test(value)) { out.employmentTerm = type; break; }
  }
  for (const [type, pattern] of WORK_TIME_PATTERNS) {
    if (pattern.test(value)) { out.workTime = type; break; }
  }
  for (const [type, pattern] of ENGAGEMENT_PATTERNS) {
    if (pattern.test(value)) { out.engagementType = type; break; }
  }
  if (SEASONAL_PATTERN.test(value)) out.isSeasonal = true;
  return out;
}

/**
 * Les codes composites d'un champ dédié, décomposés en dimensions.
 *
 * Mesuré le 2026-09-08 sur `employment_type_code` : `parttime_fixed_term` (225),
 * `fulltime_permanent` (154), `fulltime_fixed_term` (148), `parttime_permanent`
 * (41), `parttime_minijob` (15), `internship` (17), `apprenticeship` (7),
 * `contract` (7), `temporary` (3), `fulltime` (3), `freelance` (1),
 * `seasonal` (1).
 *
 * Deux garde-fous EXIGÉS, et chacun a son cas réel :
 *  - un token inconnu n'est JAMAIS forcé dans une dimension : `parttime_minijob`
 *    donne le rythme et RIEN d'autre — « minijob » est un statut allemand qui ne
 *    correspond à aucune valeur d'`employmentTerm` ;
 *  - `internship` / `apprenticeship` vont en `programType` et ne gonflent pas le
 *    gain d'`employmentTerm` juste parce qu'ils vivent dans ce champ ;
 *  - `contract` seul est refusé : en anglais d'entreprise il désigne aussi bien
 *    un CDD qu'une prestation indépendante. On ne tranche pas.
 */
const COMPOSITE_TOKENS: ReadonlyArray<readonly [RegExp, Employment]> = [
  [/\bFULL[ _-]?TIME\b|\bFULLTIME\b/, { workTime: 'FULL_TIME' }],
  [/\bPART[ _-]?TIME\b|\bPARTTIME\b/, { workTime: 'PART_TIME' }],
  // « temporary_seasonal » dit DEUX choses : une durée déterminée ET un
  // caractère saisonnier. Le drapeau n'entre plus en concurrence avec la durée.
  [/\bSEASONAL\b/, { isSeasonal: true }],
  [/\bFIXED[ _-]?TERM\b|\bFIX[ _-]?TERM\b/, { employmentTerm: 'FIXED_TERM' }],
  [/\bPERMANENT\b|\bREGULAR\b/, { employmentTerm: 'PERMANENT' }],
  [/\bTEMPORARY\b/, { employmentTerm: 'FIXED_TERM' }],
  [/\bINTERIM\b|\bAGENCY[ _-]?WORKER\b/, { employmentTerm: 'TEMPORARY' }],
  [/\bINTERNSHIP\b|\bINTERN\b|\bSTAGE\b/, { programType: 'INTERNSHIP' }],
  [/\bAPPRENTICESHIP\b|\bAPPRENTICE\b/, { programType: 'APPRENTICESHIP' }],
  [/\bGRADUATE\b/, { programType: 'GRADUATE_PROGRAM' }],
  [/\bFREELANCE\b/, { engagementType: 'FREELANCE' }],
  [/\bCONTRACTOR\b/, { engagementType: 'INDEPENDENT_CONTRACTOR' }],
];

export function decomposeCompositeCode(raw?: string | null): Employment {
  if (!raw) return {};
  // Les séparateurs deviennent des espaces pour que `\b` voie chaque token :
  // « parttime_fixed_term » → « PARTTIME FIXED TERM ».
  const value = upper(raw).replace(/[_\-/|,]+/g, ' ');
  const out: Employment = {};

  for (const [pattern, dims] of COMPOSITE_TOKENS) {
    if (!pattern.test(value)) continue;
    // La PREMIÈRE preuve gagne par dimension : l'ordre du tableau porte la
    // spécificité, et un token plus loin ne réécrit pas une dimension déjà lue.
    if (dims.workTime && !out.workTime) out.workTime = dims.workTime;
    if (dims.employmentTerm && !out.employmentTerm) out.employmentTerm = dims.employmentTerm;
    if (dims.programType && !out.programType) out.programType = dims.programType;
    if (dims.engagementType && !out.engagementType) out.engagementType = dims.engagementType;
    if (dims.isSeasonal && !out.isSeasonal) out.isSeasonal = true;
  }
  return out;
}

/** True quand une valeur ne nomme QUE un rythme — utile pour déplacer un champ mal rangé. */
export function isWorkTimeOnlyValue(raw?: string | null): boolean {
  const read = readEmployment(raw);
  return read.workTime !== undefined && !read.employmentTerm && !read.programType && !read.engagementType;
}

/** True quand une valeur nomme au moins une des quatre dimensions. */
export function isEmploymentTerm(raw?: string | null): boolean {
  const read = readEmployment(raw);
  return Object.keys(read).length > 0;
}

/**
 * Les termes d'emploi parmi les valeurs libres et configurées par tenant d'une
 * source.
 *
 * Les API de la famille Phenom (Foot Locker, Ulta/Jibe) publient ces
 * informations dans des `tags` numérotés dont chaque tenant choisit le sens :
 * Foot Locker met « Regular Part-Time » dans tags2, à côté d'une date dans
 * tags1 et d'une enseigne dans tags4. Seules les valeurs qui NOMMENT une
 * dimension sont retenues — une date ou une enseigne n'atteint jamais une colonne.
 */
export function employmentTermsFrom(values: ReadonlyArray<unknown>): string | undefined {
  const terms = values
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => (value === undefined || value === null ? '' : String(value).trim()))
    .filter((value) => value && isEmploymentTerm(value));
  return terms.length ? [...new Set(terms)].join(' · ') : undefined;
}

/**
 * Les dimensions lues dans les MOTS de l'annonce, quand les champs sont vides.
 *
 * Cas réel : Galeries Lafayette range « FULL_TIME » dans employmentType (un
 * rythme) et annonce le vrai contrat dans les dernières lignes — « 🚩 Nous
 * proposons un contrat en CDI de 35h ».
 *
 * Deux niveaux de sûreté sur un texte long :
 *  - les tokens non ambigus (CDI, CDD, intérim, V.I.E) sont acceptés PARTOUT ;
 *  - les mots qui apparaissent incidemment (« après un stage réussi »,
 *    « encadrer les alternants ») ne comptent qu'en TÊTE, où une annonce déclare
 *    sa propre nature.
 */
export function extractEmployment(title?: string | null, description?: string | null): Employment {
  const fromTitle = readEmployment(title);
  const out: Employment = { ...fromTitle };

  const text = description ?? '';
  if (!text) return out;
  const anywhere = upper(text);

  const negatedBefore = (token: string) =>
    new RegExp(`\\b(?:PAS|NON|SANS|HORS|NI)\\b[^.;:!?]{0,20}\\b${token}\\b`).test(anywhere);
  const hasToken = (re: RegExp, token: string) => re.test(anywhere) && !negatedBefore(token);

  if (!out.employmentTerm) {
    if (hasToken(/\bCDI\b/, 'CDI')) out.employmentTerm = 'PERMANENT';
    else if (hasToken(/\bCDD\b|DUREE DETERMIN/, 'CDD')) out.employmentTerm = 'FIXED_TERM';
    else if (hasToken(/\bINTERIM\b|INTERIMAIRE/, 'INTERIM')) out.employmentTerm = 'TEMPORARY';
  }
  if (!out.programType && /\bV\.I\.E\.?\b/.test(anywhere)) out.programType = 'VIE';

  // Les mots ambigus : seulement en tête de texte.
  if (!out.programType) {
    const head = upper(text.slice(0, 400));
    for (const type of ['APPRENTICESHIP', 'INTERNSHIP'] as const) {
      const pattern = PROGRAM_PATTERNS.find(([name]) => name === type)?.[1];
      if (pattern?.test(head)) { out.programType = type; break; }
    }
  }
  return out;
}
