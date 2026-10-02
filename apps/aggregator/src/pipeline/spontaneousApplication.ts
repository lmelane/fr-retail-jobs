import type { NormalizedJob } from '../types.js';
import { publicationDisposition } from './publicationDisposition.js';

/**
 * D-511 (02/10/2026) : UNE CANDIDATURE SPONTANÉE N'EST JAMAIS PUBLIÉE, QUELLE QUE SOIT LA SOURCE.
 *
 * Généralise D-508 §4 (Marc O'Polo, `marcOPolo.ts`) et la carte de join.com (Gemmyo, `joinSpontaneousCard.ts`). Une
 * publication est reconnue comme candidature spontanée sur une PREUVE NATIVE seulement, jamais devinée :
 *  - le champ de l'éditeur : `opportunityType = OPEN_APPLICATION`, lu par TalentRecruiter (`ProjectType`
 *    « OpenApplication ») et SmartRecruiters (intitulé et texte natifs de l'annonce grecque) ;
 *  - l'intitulé que la source lui donne, dans les langues servies : le libellé est l'intitulé ENTIER ou sa TÊTE, ou la
 *    tête d'un de ses segments (« MICHAEL KORS - Initiativbewerbung », « Conseiller.ère de vente - Candidature
 *    spontanée », « [Candidature spontanée] Designer »). Un libellé placé APRÈS un autre mot du même segment n'est
 *    jamais lu : « Chargé des candidatures spontanées » est un poste, il reste publié.
 *
 * L'offre est alors retenue (`NATIVE_SPONTANEOUS_APPLICATION`) avec un retrait daté : vue et nommée dans la preuve,
 * jamais publiée, une publication antérieure retirée `OUT_OF_SCOPE` (`publicationDisposition.ts`). La collecte
 * (`ats/index.ts`) et la reprise du RAW (`publication/recovery.ts`) appliquent la même règle.
 *
 * Hors règle, nommément : les « Talent Pool », « Future Opportunities », « Expression of Interest », « Vivier » qui
 * nomment un poste et un lieu ; ce sont des recrutements pour un poste défini (lecture D-492 sous D-511).
 */
export const SPONTANEOUS_APPLICATION_HOLD = 'NATIVE_SPONTANEOUS_APPLICATION';

export type SpontaneousProof =
  | { kind: 'NATIVE_FIELD'; path: 'opportunityType'; value: 'OPEN_APPLICATION' }
  | { kind: 'TITLE_LABEL'; label: string; segment: string };

/**
 * Les libellés, comparés sur l'intitulé normalisé (minuscules, sans accent). Chacun désigne la candidature spontanée
 * elle-même, jamais une fonction. Un libellé n'est reconnu que suivi de la fin, d'un séparateur ou d'un autre mot ;
 * jamais comme préfixe d'un mot plus long.
 */
const LABELS: readonly { name: string; pattern: string; ambiguous?: boolean }[] = [
  // fr, it (candidature spontanee, candidatura spontanea), es, pt
  { name: 'candidature spontanée', pattern: 'candidatur[ae]s?\\s+spontane[ae]s?' },
  { name: 'candidature libre / ouverte', pattern: 'candidatures?\\s+(?:libres?|ouvertes?)' },
  { name: 'candidatura espontánea', pattern: 'candidaturas?\\s+espontaneas?' },
  { name: 'solicitud espontánea', pattern: 'solicitud(?:es)?\\s+espontaneas?' },
  { name: 'autocandidatura', pattern: 'autocandidatur[ae]' },
  // de
  { name: 'Initiativbewerbung', pattern: 'initiativ-?\\s?bewerbung(?:en)?' },
  { name: 'Spontanbewerbung', pattern: 'spontan-?\\s?bewerbung(?:en)?' },
  // nl, sv, no, da, fi
  { name: 'open sollicitatie', pattern: '(?:open|spontane)\\s+sollicitaties?' },
  { name: 'öppen ansökan', pattern: '(?:oppen|spontan)\\s+ansokan|spontanansokan' },
  { name: 'åpen søknad', pattern: '(?:apen|spontan)\\s+soknad' },
  { name: 'uopfordret ansøgning', pattern: 'uopfordret\\s+ansogning|spontanansogning' },
  { name: 'avoin hakemus', pattern: 'avoin\\s+hakemus' },
  // en
  { name: 'spontaneous application', pattern: '(?:spontaneous|unsolicited|speculative)\\s+applications?' },
  // « open / general application » peut aussi nommer un logiciel : jamais suivi d'un nom de métier technique ou d'équipe.
  { name: 'open application', pattern: '(?:open|general)\\s+applications?', ambiguous: true },
];
const AMBIGUOUS_FOLLOWERS = '(?:engineer|engineering|developer|development|architect|architecture|platform|security|support|analyst|' +
  'programmer|integration|server|layer|interface|framework|software|team|manager|management|lead|owner|specialist|coordinator|' +
  'administrator|administration|officer|consultant|designer|testing|tester|review|reviewer)s?';
const LABEL_PATTERNS = LABELS.map(({ name, pattern, ambiguous }) => ({
  name,
  regex: new RegExp(`^(?:${pattern})(?![\\p{L}\\p{N}])${ambiguous ? `(?!\\s+${AMBIGUOUS_FOLLOWERS}(?![\\p{L}\\p{N}]))` : ''}`, 'u'),
}));

/** Minuscules, sans accent (ä → a, é → e, ø → o, å → a), apostrophes et espaces unifiés. */
function normalizeTitle(title: string): string {
  return title.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
    .toLowerCase().replace(/[’`´]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Les mentions de genre entre parenthèses, « (m/w/d) », « (H/F) », « (f/m/x) » : un séparateur, jamais un contenu. */
const GENDER_MARKER = /\(\s*(?:m|w|d|f|h|x|e|i|n|div)(?:\s*[/|,]\s*(?:m|w|d|f|h|x|e|i|n|div))+\s*\)/gu;

/**
 * Les segments d'un intitulé : l'intitulé entier, puis ce que séparent tirets ENTOURÉS d'espace (jamais le trait d'union
 * d'un mot), barres verticales ou obliques, deux-points, crochets et mentions de genre. Jamais la virgule ni le contenu
 * d'une parenthèse : « Recruteur (candidatures spontanées) » nomme un poste. La tête de chaque segment perd ses signes et
 * chiffres de tête (« 1_Candidatura Spontanea », « [Candidature spontanée] »).
 */
function titleSegments(normalized: string): string[] {
  const parts = normalized.replace(GENDER_MARKER, ' | ').split(/\s+[-–—]+\s*|\s*[-–—]+\s+|\s*[|/:[\]]+\s*/u);
  return [normalized, ...parts].map(part => part.replace(/^[^\p{L}]+/u, '').trim()).filter(Boolean);
}

/** La preuve native qu'une publication est une candidature spontanée, ou `null`. */
export function spontaneousApplicationProof(job: Pick<NormalizedJob, 'title' | 'opportunityType'>): SpontaneousProof | null {
  if (job.opportunityType === 'OPEN_APPLICATION') return { kind: 'NATIVE_FIELD', path: 'opportunityType', value: 'OPEN_APPLICATION' };
  if (typeof job.title !== 'string' || !job.title.trim()) return null;
  for (const segment of titleSegments(normalizeTitle(job.title))) {
    const match = LABEL_PATTERNS.find(label => label.regex.test(segment));
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
