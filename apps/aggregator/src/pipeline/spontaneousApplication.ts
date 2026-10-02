import type { NormalizedJob } from '../types.js';
import { publicationDisposition } from './publicationDisposition.js';

/**
 * D-511 (02/10/2026) : UNE CANDIDATURE SPONTANÉE N'EST JAMAIS PUBLIÉE, QUELLE QUE SOIT LA SOURCE.
 *
 * Généralise D-508 §4 (Marc O'Polo, `marcOPolo.ts`) et la carte de join.com (Gemmyo, `joinSpontaneousCard.ts`). Une
 * publication est reconnue comme candidature spontanée sur une PREUVE NATIVE seulement, jamais devinée :
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
 * Hors règle : les « Talent Pool », « Future Opportunities », « Expression of Interest », « Vivier » ; leur sort est une
 * question ouverte sous D-511, rien ne les retire ici.
 */
export const SPONTANEOUS_APPLICATION_HOLD = 'NATIVE_SPONTANEOUS_APPLICATION';

export type SpontaneousProof =
  | { kind: 'NATIVE_FIELD'; path: 'opportunityType'; value: 'OPEN_APPLICATION' }
  | { kind: 'TITLE_LABEL'; label: string; segment: string };

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
/** Ce qui, après le libellé, en fait l'intitulé d'un poste ou une invitation sur une vraie offre. */
const FOLLOWERS = 'coordinator|coordinateur|coordinatrice|manager|management|specialist|specialiste|officer|assistant|assistante|' +
  'administrator|administrateur|administratrice|recruiter|recruteur|recruteuse|handling|review|reviewer|lead|team|equipe|' +
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

/** La preuve native qu'une publication est une candidature spontanée, ou `null`. */
export function spontaneousApplicationProof(job: Pick<NormalizedJob, 'title' | 'opportunityType'>): SpontaneousProof | null {
  if (job.opportunityType === 'OPEN_APPLICATION') return { kind: 'NATIVE_FIELD', path: 'opportunityType', value: 'OPEN_APPLICATION' };
  if (typeof job.title !== 'string' || !job.title.trim()) return null;
  const { head, segments } = titleSegments(normalizeTitle(job.title.slice(0, MAX_TITLE_LENGTH)));
  const atHead = LABEL_PATTERNS.find(label => label.head.test(head));
  if (atHead) return { kind: 'TITLE_LABEL', label: atHead.name, segment: head };
  for (const segment of segments) {
    const match = LABEL_PATTERNS.find(label => label.segment.test(segment));
    if (match) return { kind: 'TITLE_LABEL', label: match.name, segment };
  }
  return null;
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
