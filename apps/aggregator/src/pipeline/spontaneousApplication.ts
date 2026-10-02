import { cleanTitle } from '../lib/normalize.js';
import type { NormalizedJob } from '../types.js';
import { publicationDisposition } from './publicationDisposition.js';

/**
 * D-511 (02/10/2026) : UNE CANDIDATURE SPONTANÉE N'EST JAMAIS PUBLIÉE, QUELLE QUE SOIT LA SOURCE.
 *
 * Généralise D-508 §4 (Marc O'Polo, `marcOPolo.ts`) et la carte de join.com (Gemmyo, `joinSpontaneousCard.ts`). Une
 * publication est reconnue comme candidature spontanée sur une PREUVE NATIVE seulement, jamais devinée (le vivier de
 * D-512, plus bas, fait exception : son absence de poste est une DÉDUCTION, pas une preuve native) :
 *  - le champ de l'éditeur : `opportunityType = OPEN_APPLICATION`, lu par TalentRecruiter (`ProjectType`
 *    « OpenApplication ») et SmartRecruiters (intitulé et texte natifs de l'annonce grecque) ;
 *  - l'intitulé que la source lui donne, dans les langues servies : le libellé est l'intitulé ENTIER ou sa TÊTE (au
 *    singulier ou au pluriel), ou, AU SINGULIER seulement, la tête d'un de ses segments (« MICHAEL KORS -
 *    Initiativbewerbung », « Conseiller.ère de vente - Candidature spontanée »). Un libellé placé APRÈS un autre mot du
 *    même segment n'est jamais lu, ni un pluriel après un séparateur (« Recruteur - Candidatures spontanées » nomme le
 *    domaine d'un poste), ni un libellé suivi d'une fonction ou d'une invitation (« Spontaneous Applications
 *    Coordinator », « Initiativbewerbung möglich », « Open Application Day ») : ces postes restent publiés.
 *
 * L'offre est alors retenue (`NATIVE_SPONTANEOUS_APPLICATION`) avec un retrait daté : vue et nommée dans la preuve,
 * jamais publiée, une publication antérieure retirée `OUT_OF_SCOPE` (`publicationDisposition.ts`). La collecte
 * (`ats/index.ts`) et la reprise du RAW (`publication/recovery.ts`) appliquent la même règle.
 *
 * D-512 (02/10/2026) prolonge la retenue et le retrait aux VIVIERS : un « Talent Pool », « Future Opportunities »,
 * « Expression of Interest », « Register your interest » ou « Vivier » dont le reste de l'intitulé ne nomme QUE le lieu,
 * la Maison, le pays ou une langue de l'offre, ou rien (« Future Opportunities - (Boston) », « Mejuri Talent
 * Community »). Tout autre mot, connu ou non (« Store Manager », « Store Team », « Florist », « Stage »), garde l'offre
 * publiée. Le libellé est lu dans l'intitulé ; l'absence de poste, elle, est DÉDUITE de ce qui reste (`onlyPlaceOrHouse`) :
 * un vocabulaire inconnu ne retire jamais.
 */
export const SPONTANEOUS_APPLICATION_HOLD = 'NATIVE_SPONTANEOUS_APPLICATION';

export type SpontaneousProof =
  | { kind: 'NATIVE_FIELD'; path: 'opportunityType'; value: 'OPEN_APPLICATION' }
  | { kind: 'TITLE_LABEL'; label: string; segment: string }
  /** D-512 : un vivier ; `remainder` est ce que l'intitulé dit en dehors du libellé, où aucun poste n'est lu. */
  | { kind: 'TALENT_POOL'; label: string; remainder: string };

/**
 * Les libellés, comparés sur l'intitulé normalisé (minuscules, sans accent) : `one` au singulier, `many` au pluriel.
 * Chacun désigne la candidature spontanée elle-même, jamais une fonction. Un libellé n'est reconnu que suivi de la fin,
 * d'un séparateur ou d'un autre mot ; jamais comme préfixe d'un mot plus long. « Candidatures ouvertes » n'en est pas un
 * (en français, un poste dont les candidatures sont ouvertes).
 */
const LABELS: readonly { name: string; one: string; many?: string; ambiguous?: boolean }[] = [
  // fr, it (candidatura spontanea ; son pluriel s'écrit comme le singulier français), es, pt
  { name: 'candidature spontanée', one: 'candidature\\s+spontanee|candidatura\\s+spontanea', many: 'candidatures\\s+spontanees' },
  { name: 'candidature libre / ouverte', one: 'candidature\\s+(?:libre|ouverte)|candidatura\\s+libera' },
  { name: 'candidatura espontánea', one: 'candidatura\\s+(?:espontanea|abierta)', many: 'candidaturas\\s+espontaneas' },
  { name: 'solicitud espontánea', one: 'solicitud\\s+espontanea', many: 'solicitudes\\s+espontaneas' },
  { name: 'autocandidatura', one: 'autocandidatura', many: 'autocandidature' },
  // de
  { name: 'Initiativbewerbung', one: 'initiativ-?\\s?bewerbung|spontane\\s+bewerbung', many: 'initiativ-?\\s?bewerbungen|spontane\\s+bewerbungen' },
  { name: 'Spontanbewerbung', one: 'spontan-?\\s?bewerbung', many: 'spontan-?\\s?bewerbungen' },
  // nl, sv, no, da, fi
  { name: 'open sollicitatie', one: '(?:open|spontane)\\s+sollicitatie', many: '(?:open|spontane)\\s+sollicitaties' },
  { name: 'öppen ansökan', one: '(?:oppen|spontan)\\s+ansokan|spontanansokan' },
  { name: 'åpen søknad', one: '(?:apen|spontan)\\s+soknad' },
  { name: 'uopfordret ansøgning', one: 'uopfordret\\s+ansogning|spontanansogning' },
  { name: 'avoin hakemus', one: 'avoin\\s+hakemus' },
  // en
  { name: 'spontaneous application', one: '(?:spontaneous|unsolicited|speculative)\\s+application', many: '(?:spontaneous|unsolicited|speculative)\\s+applications' },
  // « open / general application » peut aussi nommer un logiciel : jamais suivi d'un mot technique.
  { name: 'open application', one: '(?:open|general)\\s+application', many: '(?:open|general)\\s+applications', ambiguous: true },
];
/** Les mots de fonction : après un libellé, ils en font l'intitulé d'un poste (« Spontaneous Applications Coordinator »,
 * « Talent Pool Coordinator », « Talent Community Manager »). */
const FUNCTION_NOUNS = 'coordinator|coordinateur|coordinatrice|manager|specialist|specialiste|officer|assistant|assistante|' +
  'administrator|administrateur|administratrice|recruiter|recruteur|recruteuse|reviewer|lead|host|hostess|keeper|' +
  'gestionnaire|animateur|animatrice';
/** Ce qui, après le libellé, en fait l'intitulé d'un poste ou une invitation sur une vraie offre. */
const FOLLOWERS = `${FUNCTION_NOUNS}|management|handling|review|team|equipe|` +
  'process|processus|day|days|journee|journees|event|events|evenement|evenements|moglich|willkommen|welcome|accepted|' +
  'acceptee|acceptees|bienvenue|bienvenues|benvenute|bienvenidas';
const TECHNICAL_FOLLOWERS = 'engineer|engineering|developer|development|architect|architecture|platform|security|support|analyst|' +
  'programmer|integration|server|layer|interface|framework|software|data|system|systems|testing|tester|consultant|designer|owner|administration';
const labelRegex = (pattern: string, ambiguous?: boolean) => new RegExp(`^(?:${pattern})(?![\\p{L}\\p{N}])` +
  `(?![\\s/&+]*(?:${FOLLOWERS}${ambiguous ? `|${TECHNICAL_FOLLOWERS}` : ''})s?(?![\\p{L}\\p{N}]))`, 'u');
const LABEL_PATTERNS = LABELS.map(({ name, one, many, ambiguous }) => ({
  name,
  /** En tête de l'intitulé entier : singulier ou pluriel. */
  head: labelRegex(many ? `${many}|${one}` : one, ambiguous),
  /** En tête d'un segment qui suit un séparateur : singulier seulement. */
  segment: labelRegex(one, ambiguous),
}));

/** Un intitulé plus long n'est pas lu au-delà (le découpage reste linéaire en pratique). */
const MAX_TITLE_LENGTH = 300;

/** Minuscules, sans accent (ä → a, é → e, ø → o, å → a), apostrophes et espaces unifiés. */
function normalizeTitle(title: string): string {
  return title.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .toLowerCase().replace(/[’`´]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Les mentions de genre entre parenthèses, « (m/w/d) », « (H/F) », « (f/m/x) » : un séparateur, jamais un contenu. */
const GENDER_MARKER = /\(\s*(?:m|w|d|f|h|x|e|i|n|div)(?:\s*[/|,]\s*(?:m|w|d|f|h|x|e|i|n|div))+\s*\)/gu;

/**
 * Les segments d'un intitulé : sa tête (l'intitulé entier), puis ce que séparent tirets ENTOURÉS d'espace (jamais le trait d'union
 * d'un mot), barres verticales ou obliques, deux-points, crochets et mentions de genre. Jamais la virgule ni le contenu
 * d'une parenthèse : « Recruteur (candidatures spontanées) » nomme un poste. La tête de chaque segment perd ses signes et
 * chiffres de tête (« 1_Candidatura Spontanea », « [Candidature spontanée] »).
 */
function titleSegments(normalized: string): { head: string; segments: string[] } {
  const strip = (part: string) => part.replace(/^[^\p{L}]+/u, '').trim();
  const parts = normalized.replace(GENDER_MARKER, ' | ').split(/\s+[-–—]+\s*|\s*[-–—]+\s+|\s*[|/:[\]]+\s*/u);
  return { head: strip(normalized), segments: parts.map(strip).filter(Boolean) };
}

/**
 * D-512 — les libellés d'un vivier, comparés sur l'intitulé normalisé, n'importe où dans l'intitulé (« Store Manager -
 * London Future Opportunities ») : jamais comme fragment d'un mot, jamais « Roger Vivier » (une Maison), jamais suivis
 * d'un mot de fonction ou d'équipe (« Talent Pool Coordinator »). Les formes sont celles que la production publie le
 * 02/10/2026 (`audits/2026-10-02/d512-viviers/decouverte.sql`) : au-delà des cinq libellés de la décision, leurs
 * variantes « Talent Community / Network », « Talentpool », « Expressions of Interest », « Express Interest »,
 * « Opportunités futures », « Bolsa de Talentos ».
 */
const TALENT_POOL_LABELS: readonly { name: string; pattern: string }[] = [
  { name: 'talent pool', pattern: 'talent[- ]?(?:pool|community|network)s?' },
  { name: 'future opportunities', pattern: 'future\\s+opportunit(?:y|ies)|opportunites?\\s+futures?' },
  { name: 'expression of interest', pattern: 'expressions?\\s+of\\s+interest|express\\s+(?:your\\s+)?interest' },
  { name: 'register your interest', pattern: 'register\\s+(?:your\\s+)?interest' },
  { name: 'vivier', pattern: '(?<!roger[\\s-])vivier(?:\\s+de\\s+(?:candidats|talents))?' },
  { name: 'bolsa de talentos', pattern: 'bolsa\\s+de\\s+talentos?' },
];
const TALENT_POOL_PATTERNS = TALENT_POOL_LABELS.map(({ name, pattern }) => ({ name,
  regex: new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])(?![\\s/&+]*(?:${FOLLOWERS})s?(?![\\p{L}\\p{N}]))`, 'gu') }));

/**
 * D-512 — ce qui, hors libellé, ne nomme AUCUN poste : les mots vides d'une invitation (« Join our », « Apply here
 * to »), les zones et sigles régionaux (« APAC », « EMEA », « UK », « Greater … Area »). Liste fermée et courte : tout
 * mot qui n'y est pas, et que le lieu, la Maison, le pays ou la langue de l'offre n'expliquent pas, garde l'offre publiée.
 */
const EMPTY_WORDS = new Set(('join our the us apply here to now and or for in at of on with de d du des la le les l et ou en a au aux ' +
  'notre nos votre vos your all uk usa uae eu emea apac latam amer americas mena gcc area region greater metro city various ' +
  'multiple locations location remote worldwide global international nationwide hq headquarters').split(' '));
/** Les langues des marchés servis : leur nom, dans cinq langues, explique « Multilingual », « German speaking »… */
const LANGUAGE_CODES = 'en fr de it es pt nl sv no nb da fi ja zh ko ar ru pl tr el cs hu ro he hi th vi id ms'.split(' ');
const DISPLAY_LOCALES = ['en', 'fr', 'de', 'it', 'es'];
const lower = (value: string) => normalizeTitle(value);
/** Les noms de pays (codes ISO 3166 que la plateforme connaît, `Intl.DisplayNames`) et de langues, dans cinq langues. */
const PLACE_AND_LANGUAGE_PHRASES: RegExp = (() => {
  const phrases = new Set<string>(['multilingual', 'multilingue', 'bilingual', 'bilingue', 'speaking', 'speaker', 'speakers']);
  for (const locale of DISPLAY_LOCALES) {
    const regions = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' });
    const languages = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' });
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const name = regions.of(String.fromCharCode(a, b));
      if (name) phrases.add(lower(name));
    }
    for (const code of LANGUAGE_CODES) { const name = languages.of(code); if (name) phrases.add(lower(name)); }
  }
  const sorted = [...phrases].filter(Boolean).sort((x, y) => y.length - x.length).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${sorted.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
})();
const words = (value: string) => lower(value).replace(/'s(?![\p{L}\p{N}])/gu, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Ce que l'offre dit d'elle-même ailleurs que dans l'intitulé : son lieu, sa ville, son pays, sa Maison. */
export type TalentPoolContext = Partial<Pick<NormalizedJob, 'company' | 'location' | 'city' | 'country'>>;

/**
 * Le reste d'un vivier ne nomme-t-il qu'un lieu, une Maison, un pays, une langue ou des mots vides ? Les lieux et la
 * Maison sont ceux de l'offre elle-même (son lieu, sa ville, son pays, son employeur), plus les noms de pays et de
 * langues ; les nombres (une année, un code postal) aussi. Un seul autre mot suffit à garder l'offre publiée : un poste
 * que nul vocabulaire ne connaît (« Florist »), un contrat (« Stage »), un public (« Student »), une équipe. C'est une
 * déduction, prudente par construction : un vocabulaire inconnu ne retire jamais.
 */
function onlyPlaceOrHouse(remainder: string, context: TalentPoolContext): boolean {
  const own = new Set([context.company, context.location, context.city, context.country].flatMap(v => typeof v === 'string' ? words(v) : []));
  if (typeof context.country === 'string' && /^[a-z]{2}$/i.test(context.country.trim())) {
    for (const locale of DISPLAY_LOCALES) {
      const name = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }).of(context.country.trim().toUpperCase());
      if (name) words(name).forEach(w => own.add(w));
    }
  }
  return words(remainder.replace(PLACE_AND_LANGUAGE_PHRASES, ' '))
    .every(w => /^\p{N}+$/u.test(w) || EMPTY_WORDS.has(w) || own.has(w));
}

/** D-512 : la lecture d'un vivier dans un intitulé normalisé — son libellé, ce qui reste, et si ce reste nomme un poste. */
function readTalentPool(normalized: string, context: TalentPoolContext): { label: string; remainder: string; namesAPost: boolean } | null {
  const label = TALENT_POOL_PATTERNS.find(({ regex }) => { regex.lastIndex = 0; return regex.test(normalized); });
  if (!label) return null;
  const withoutLabels = TALENT_POOL_PATTERNS.reduce((text, { regex }) => text.replace(regex, ' | '), normalized);
  const remainder = withoutLabels.replace(GENDER_MARKER, ' ').split(/\s+[-–—]+\s*|\s*[-–—]+\s+|[|/:;,()[\]{}!?#]+/u)
    .map(part => part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim())
    .filter(Boolean).join(' | ');
  return { label: label.name, remainder, namesAPost: !onlyPlaceOrHouse(remainder, context) };
}

/**
 * L'intitulé tel que les deux règles le lisent, calculé une fois : tronqué AVANT le nettoyage (borne le coût des
 * expressions de `cleanTitle`), nettoyé comme à l'écriture (entités, balises : l'adaptateur rend « D&#233;l&#233;gu&#233;
 * Pharmaceutique » chez Beiersdorf, « Candidature spontan&#233;e » se lit), normalisé, puis borné à 300 caractères.
 */
function readableTitle(title: string): string {
  const sliced = title.slice(0, 4 * MAX_TITLE_LENGTH);
  return normalizeTitle(cleanTitle(sliced) ?? sliced).slice(0, MAX_TITLE_LENGTH);
}

/** D-512, pour la mesure : la lecture du vivier que porte un intitulé (retenu ou conservé), ou `null` s'il n'en porte pas. */
export function talentPoolReading(title: string, context: TalentPoolContext = {}) {
  return readTalentPool(readableTitle(title), context);
}

/**
 * La preuve qu'une publication est une candidature spontanée (D-511 : preuve native, champ ou libellé) ou un vivier dont
 * le reste ne nomme qu'un lieu, une Maison, une langue ou des mots vides (D-512 : libellé lu, absence de poste DÉDUITE),
 * ou `null`.
 */
export function spontaneousApplicationProof(job: Pick<NormalizedJob, 'title' | 'opportunityType'> & TalentPoolContext): SpontaneousProof | null {
  if (job.opportunityType === 'OPEN_APPLICATION') return { kind: 'NATIVE_FIELD', path: 'opportunityType', value: 'OPEN_APPLICATION' };
  if (typeof job.title !== 'string' || !job.title.trim()) return null;
  const normalized = readableTitle(job.title);
  const { head, segments } = titleSegments(normalized);
  const atHead = LABEL_PATTERNS.find(label => label.head.test(head));
  if (atHead) return { kind: 'TITLE_LABEL', label: atHead.name, segment: head };
  for (const segment of segments) {
    const match = LABEL_PATTERNS.find(label => label.segment.test(segment));
    if (match) return { kind: 'TITLE_LABEL', label: match.name, segment };
  }
  const reading = readTalentPool(normalized, job);
  return reading && !reading.namesAPost ? { kind: 'TALENT_POOL', label: reading.label, remainder: reading.remainder } : null;
}

/**
 * Retient une candidature spontanée, datée par `observedAt` (le début de la collecte) pour retirer une publication
 * antérieure. Une offre déjà retirée par une autre preuve native (404, clôture déclarée, Marc O'Polo…) garde sa
 * raison ; une retenue sans retrait (employeur non résolu…) cède la place : la candidature spontanée la retire.
 */
export function applySpontaneousApplicationRule(job: NormalizedJob, observedAt: Date): NormalizedJob {
  if (job.publicationWithdrawnAt || (job.publicationHold && publicationDisposition(job.publicationHold))) return job;
  if (!spontaneousApplicationProof(job)) return job;
  return { ...job, publicationHold: SPONTANEOUS_APPLICATION_HOLD, publicationWithdrawnAt: observedAt };
}
