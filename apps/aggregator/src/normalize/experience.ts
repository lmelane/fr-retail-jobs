/**
 * EXPÉRIENCE ET NIVEAU D'ÉTUDES — lire ce que la source DÉCLARE, sans l'inventer.
 *
 * ── LE DÉFAUT MESURÉ (2026-09-15, base de production) ─────────────────────
 *
 * Deux colonnes existaient, alimentées par presque personne, alors que la
 * donnée arrivait et dormait dans `raw` :
 *
 *   `experienceYears`  499 / 87 580 offres   (WTTJ 447, Harri 36 — les seuls)
 *   `educationLevel`     0 / 87 580 offres   (AUCUN producteur : le champ
 *                                             n'existait que comme type, comme
 *                                             pass-through d'upsert, et comme
 *                                             remise à null dans oracle.ts)
 *
 * Pendant ce temps, `raw` portait la donnée sur des milliers d'offres.
 *
 * ── LA CONVENTION DE LA COLONNE, VÉRIFIÉE AVANT D'ÉCRIRE ──────────────────
 *
 * `experienceYears` est un `Int?`, et les deux seuls producteurs existants y
 * écrivent des ANNÉES, brutes, sans échelle (mesuré en base : WTTJ écrit
 * 0,1,2,3,4,5,7,10 ; Harri 1 et 2). Le contrat de `types.ts` le dit :
 * « Minimum experience, in years, when stated numerically ».
 *
 * On écrit donc des ANNÉES. Pas des mois, pas un rang d'échelle : introduire
 * une seconde convention dans une colonne déjà peuplée rendrait les 499 valeurs
 * existantes illisibles, et aucune relecture ne pourrait dire laquelle est
 * laquelle.
 *
 * `educationLevel` est un `String?`, et son contrat dit « Education level as
 * worded by the source ». On y conserve donc le LIBELLÉ NATIF, pas un rang.
 *
 * ── LE PRINCIPE QUI TRANCHE : JAMAIS DE FAUSSE DONNÉE ─────────────────────
 *
 * Une échelle de séniorité n'est PAS une durée. `mid_senior_level` (LinkedIn,
 * repris par SmartRecruiters) ne dit AUCUN nombre d'années : deux entreprises
 * le posent à 3 ans et à 10 ans. Convertir une échelle en années, ce serait
 * fabriquer un chiffre que la source n'a jamais écrit — et un candidat filtrant
 * « 5 ans d'expérience » verrait des offres qui n'en demandent pas.
 *
 * D'où la règle, appliquée sans exception ci-dessous :
 *   - la source dit une DURÉE  → on la lit et on l'écrit ;
 *   - la source dit un RANG    → on ne l'écrit PAS dans `experienceYears` ;
 *   - la source dit une ABSENCE (`not_applicable`) → on n'écrit rien. Ce n'est
 *     pas zéro : zéro est une exigence (« débutant accepté »), l'absence est un
 *     silence.
 *
 * Une case vide se répare. Une valeur fausse ne se voit pas.
 */

/**
 * Les DURÉES déclarées par LVMH, lues depuis `requiredExperienceFilter`.
 *
 * ATTENTION — le champ à lire n'est PAS `requiredExperience`.
 *
 * `requiredExperience` est le libellé D'AFFICHAGE, traduit dans la langue de
 * l'annonce : mesuré en base, il porte 25 valeurs distinctes en six langues
 * (« Minimum 3 years », « Minimum 3 ans », « Mindestens 3 Jahre », « Almeno 3
 * anni », « 3年以上 », « 两年及以上 », « Débutant », « Berufseinsteiger(in) »,
 * « Prima Esperienza », « 未経験者 »…). Mapper ce champ obligerait à maintenir
 * une table de traduction qui se périmerait au premier marché ouvert.
 *
 * `requiredExperienceFilter` est la forme CANONIQUE, indépendante de la langue,
 * que le site utilise lui-même pour sa facette : exactement 4 valeurs, sur
 * 5 443 offres. C'est elle qu'on lit.
 *
 * Les 1 223 offres LVMH sans `requiredExperienceFilter` n'ont AUCUNE des deux
 * clés (mesuré : 0 offre porte le libellé sans le filtre) — il n'y a donc rien
 * à rattraper par le champ d'affichage.
 */
const LVMH_YEARS: Record<string, number> = {
  // « Débutant » / « Berufseinsteiger(in) » : l'offre est ouverte à qui n'a pas
  // d'expérience. C'est bien 0 AN EXIGÉ — une exigence, pas une absence.
  Beginner: 0,
  'Minimum 3 years': 3,
  'Minimum 5 years': 5,
  'Minimum 10 years': 10,
};

/**
 * L'expérience exigée par une offre LVMH, en années, ou `undefined`.
 *
 * Une valeur inconnue rend `undefined` plutôt que de deviner : si LVMH ajoute
 * « Minimum 15 years », mieux vaut une case vide qu'un chiffre inventé, et le
 * témoin de couverture le signalera.
 */
export function lvmhExperienceYears(raw?: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim();
  if (!key) return undefined;
  return Object.hasOwn(LVMH_YEARS, key) ? LVMH_YEARS[key] : undefined;
}

/**
 * Les BORNES BASSES déclarées par Personio, lues depuis `yearsOfExperience`.
 *
 * C'est la SEULE échelle de ce lot qui énonce une vraie durée : ses valeurs
 * sont des intervalles d'années explicites (mesuré en base : `lt-1`, `1-2`,
 * `2-5`, `5-7`, `7-10`, `10-15`, `gt-15`). On en prend la BORNE BASSE, qui est
 * l'exigence minimale — cohérent avec WTTJ, dont le champ source s'appelle
 * littéralement `experience_level_minimum`.
 *
 * `lt-1` (« moins d'un an ») → 0 : l'exigence minimale est bien nulle.
 *
 * À ne PAS confondre avec `seniority` (`experienced`, `entry-level`,
 * `student`, `executive`), présent sur 251 offres du même ATS : celui-là est un
 * RANG, il ne dit aucune durée, et il n'est pas lu ici.
 */
const PERSONIO_YEARS: Record<string, number> = {
  'lt-1': 0,
  '1-2': 1,
  '2-5': 2,
  '5-7': 5,
  '7-10': 7,
  '10-15': 10,
  'gt-15': 15,
};

/** L'expérience minimale exigée par une offre Personio, en années, ou `undefined`. */
export function personioExperienceYears(raw?: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim();
  if (!key) return undefined;
  return Object.hasOwn(PERSONIO_YEARS, key) ? PERSONIO_YEARS[key] : undefined;
}

/**
 * ── CE QU'ON REFUSE D'ÉCRIRE DANS `experienceYears`, ET POURQUOI ──────────
 *
 * Ces champs existent, sont abondants, et ont été mesurés. Aucun n'est écrit :
 * tous sont des RANGS DE SÉNIORITÉ, pas des durées.
 *
 *   SMARTRECRUITERS.experienceLevel   6 243 offres
 *     entry_level 2 207 · not_applicable 1 667 · mid_senior_level 1 510 ·
 *     associate 709 · executive 71 · internship 59 · director 20
 *     → échelle LinkedIn. `associate` et `mid_senior_level` ne portent aucune
 *       durée : leur donner 2 et 5 ans serait une invention pure. Et
 *       `not_applicable` (1 667 offres, le 2e volume !) est une ABSENCE, pas 0.
 *
 *   RECRUITEE.experience_code         653 offres
 *     entry_level 228 · mid_level 167 · experienced 131 · student_school 74 ·
 *     student_college 28 · manager 21 · senior_manager 4
 *     → rang, et `manager` / `senior_manager` sont même des rangs
 *       HIÉRARCHIQUES, pas des niveaux d'expérience.
 *
 *   WORKABLE.experience               279 offres (dont 112 vides + 45 null)
 *     Associate 65 · Mid-Senior level 29 · Entry level 26 · Director 2
 *     → même échelle LinkedIn, et 157 des 279 ne disent rien du tout.
 *
 *   PERSONIO.seniority                251 offres  → rang (voir ci-dessus).
 *
 * Ces libellés méritent une colonne de SÉNIORITÉ à part (une colonne
 * `seniority` existe d'ailleurs déjà au schéma). L'ouvrir est une décision
 * produit : elle n'est pas prise ici, et rien n'est écrit en attendant.
 */

/**
 * Les NIVEAUX D'ÉTUDES, conservés dans le libellé NATIF de la source.
 *
 * ── POURQUOI AUCUNE ÉCHELLE UNIQUE ────────────────────────────────────────
 *
 * Les diplômes ne sont pas comparables entre pays. Un « bac_5 » français, un
 * « master_degree » néerlandais et un « Bachelor's Degree » américain ne se
 * rangent pas sur un même axe sans trahir au moins l'un des trois ; un
 * `vocational` (134 offres Recruitee) n'a pas d'équivalent français simple —
 * CAP, BEP et Ausbildung allemande couvrent des réalités différentes.
 *
 * Canoniser de force produirait de la donnée fausse. On conserve donc le
 * libellé SOURCE, conformément au contrat de la colonne (« Education level as
 * worded by the source »), en le préfixant par le référentiel qui lui donne son
 * sens — sans quoi `bachelor_degree` et `bac_3` deviendraient indistinguables
 * de leurs homonymes d'autres ATS.
 *
 * La comparaison entre référentiels reste possible plus tard, sur ces valeurs
 * tracées ; elle serait impossible sur une échelle déjà aplatie.
 */
export type EducationReferential = 'RECRUITEE' | 'WTTJ' | 'WORKABLE';

/**
 * Les valeurs qui ne DISENT RIEN, écartées avant écriture.
 *
 * Mesuré : Workable porte 210 chaînes vides, 45 `null` et 24 « Unspecified » —
 * soit 279 offres dont 279... moins 45 utiles. Écrire « Unspecified » dans la
 * colonne remplirait la facette de bruit et ferait croire à une donnée.
 */
const EDUCATION_EMPTY = new Set(['', 'unspecified', 'not specified', 'none', 'n/a']);

/**
 * Le niveau d'études déclaré, préfixé par son référentiel, ou `undefined`.
 *
 * Exemples : `RECRUITEE:bachelor_degree`, `WTTJ:bac_5`, `WORKABLE:Bachelor's Degree`.
 */
export function educationLevel(
  referential: EducationReferential,
  raw?: unknown,
): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value || EDUCATION_EMPTY.has(value.toLowerCase())) return undefined;
  return `${referential}:${value}`;
}

/**
 * ── CE QU'ON REFUSE D'ÉCRIRE DANS `educationLevel`, ET POURQUOI ───────────
 *
 *   GREENHOUSE.education              414 offres
 *     education_optional 354 · education_required 60
 *     → CE N'EST PAS UN NIVEAU D'ÉTUDES. C'est un drapeau de FORMULAIRE de
 *       candidature : il dit si le candidat DOIT renseigner sa formation pour
 *       postuler, pas quel diplôme l'offre exige. Aucun diplôme n'y figure.
 *
 *       C'est le piège exact que l'énumération des valeurs a permis d'éviter :
 *       le nom de la clé (`education`) et son volume (414) en faisaient un
 *       candidat évident, et seule la lecture des VALEURS montre qu'il ne porte
 *       aucune information de diplôme. Rien n'en est écrit.
 */
