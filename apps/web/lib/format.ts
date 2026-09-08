const RELATIVE = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

/**
 * Offer title, normalised for display only (design_2.md [UX] §2.3): a source
 * that shouts "STAGE - INGENIEUR.E PLANIFICATION (H/F)" is rendered
 * "Stage - Ingénieur.e planification (H/F)". Sentence case — first letter up,
 * the rest down — EXCEPT recognised acronyms and tokens already mixed-case in the
 * source (a real Maison name like "iOS" or "L'Oréal" keeps its casing). The
 * ingest and the stored value are untouched; this is purely at render time.
 */
const KEEP_UPPER = new Set([
  'H/F', 'F/H', 'H', 'F', 'CDI', 'CDD', 'VIE', 'RTW', 'S&OP', 'DE&I', 'HR', 'RH', 'IT',
  'CDD/CDI', 'BTP', 'QHSE', 'RSE', 'KPI', 'B2B', 'B2C', 'UX', 'UI', 'PLV', 'SAV',
]);
export function displayTitle(raw: string): string {
  if (!raw) return raw;
  // Only rewrite a title that is (almost) all-caps — leave a well-cased one alone.
  const letters = raw.replace(/[^A-Za-zÀ-ÿ]/g, '');
  const isShouting = letters.length > 0 && letters === letters.toUpperCase();
  return raw
    .split(/(\s+|[-–—/·|(),])/)
    .map((tok) => {
      if (!/[A-Za-zÀ-ÿ]/.test(tok)) return tok; // separators/spaces
      const upper = tok.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      // Roman numerals (II, III, IV…) and any short token containing & (FP&A,
      // S&OP, R&D) stay uppercase — they read wrong title-cased.
      if (/^[IVXLCDM]{2,}$/.test(upper) || (upper.includes('&') && upper.length <= 5)) return upper;
      // A token that is mixed-case in the source is intentional — keep it.
      if (!isShouting && tok !== upper) return tok;
      return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
    })
    .join('')
    .replace(/^(.)/, (c) => c.toUpperCase());
}

/**
 * "il y a 3 jours" rather than a date: on a job board, recency is the signal a
 * candidate scans for, and an absolute date makes them do the arithmetic.
 *
 * Kept out of lib/utils.ts because the shadcn CLI owns that file and overwrites
 * it on every `add`.
 */
export function relativeDate(date: Date | string | null): string {
  if (!date) return '';
  const days = Math.round((new Date(date).getTime() - Date.now()) / 86_400_000);
  if (days === 0) return "aujourd'hui";
  if (days > -31) return RELATIVE.format(days, 'day');
  return RELATIVE.format(Math.round(days / 30), 'month');
}

/**
 * LA COUCHE DE LOCALISATION — l'unique endroit où la taxonomie mondiale
 * redevient des mots français.
 *
 * Depuis la refonte du 2026-09-08, la base stocke la NATURE de la relation
 * d'emploi en vocabulaire mondial (`PERMANENT`, `FIXED_TERM`…) et non plus une
 * grille juridique française. « CDI » n'est plus une valeur : c'est le mot que
 * lit un candidat français pour `PERMANENT`.
 *
 * Deux conséquences à ne pas perdre de vue :
 *  - `PERMANENT` → « CDI » est une TRADUCTION d'affichage, pas une équivalence
 *    juridique : un « Permanent » britannique n'est pas régi par le droit
 *    français. Un futur marché non francophone traduira autrement, sans
 *    toucher à la donnée.
 *  - `null` signifie « la source ne le dit pas ». Rien ne s'affiche alors —
 *    l'ancien « UNKNOWN » stocké finissait en pastille littérale à l'écran.
 */
const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  PERMANENT: 'CDI',
  FIXED_TERM: 'CDD',
  TEMPORARY: 'Intérim',
  INTERNSHIP: 'Stage',
  APPRENTICESHIP: 'Alternance',
  SEASONAL: 'Saisonnier',
  FREELANCE: 'Freelance',
  INDEPENDENT_CONTRACTOR: 'Indépendant',
  OTHER: 'Autre',
};

const WORK_TIME_LABELS: Record<string, string> = {
  FULL_TIME: 'Temps plein',
  PART_TIME: 'Temps partiel',
  OTHER: 'Autre',
};

/** Le libellé français d'une nature de relation d'emploi, ou null si absente. */
export function employmentTermLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return EMPLOYMENT_TYPE_LABELS[value] ?? value;
}

/** Les dispositifs, dans les mots que lit un candidat français. */
const PROGRAM_TYPE_LABELS: Record<string, string> = {
  INTERNSHIP: 'Stage',
  APPRENTICESHIP: 'Alternance',
  GRADUATE_PROGRAM: 'Graduate program',
  VIE: 'V.I.E',
};

/** Le MODE DE TRAVAIL, dans les mots que lit un candidat français. */
const WORKPLACE_TYPE_LABELS: Record<string, string> = {
  ONSITE: 'Sur site',
  HYBRID: 'Hybride',
  REMOTE: 'Télétravail',
};

/** Le libellé français d'un mode de travail, ou null si absent. */
export function workplaceTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return WORKPLACE_TYPE_LABELS[value] ?? value;
}

/** Le libellé français d'un dispositif, ou null si absent. */
export function programTypeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return PROGRAM_TYPE_LABELS[value] ?? value;
}

/** Le libellé français d'un rythme de travail, ou null si absent. */
export function workTimeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return WORK_TIME_LABELS[value] ?? value;
}

/**
 * fr-FR sépare les milliers par une espace fine insécable (U+202F) que la
 * police display du site ne dessine pas — « 71525 » sur le hero (mesuré en
 * prod le 2026-09-06). L'espace insécable classique existe partout.
 */
const NF_FR = new Intl.NumberFormat('fr-FR');
export const frNumber = { format: (n: number) => NF_FR.format(n).replace(/\u202f/g, '\u00a0') };
