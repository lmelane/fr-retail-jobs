import { employmentLabel } from '@catwalks/db/presentation';

/*
 * ── CE QUI A ÉTÉ RETIRÉ D'ICI, ET POURQUOI ÇA NE REVIENT PAS (lot 4A) ──────
 *
 * Trois utilitaires de RENDU vivaient dans ce fichier — `displayTitle` (casse
 * des titres criés), `relativeDate` (« il y a 3 jours »), `frNumber` (espace
 * fine insécable) — plus les trois constantes qui ne servaient qu'à eux
 * (`KEEP_UPPER`, `RELATIVE`, `NF_FR`).
 *
 * Ils ont été écrits pour un front web qui N'EXISTE PLUS dans ce dépôt : il ne
 * reste qu'un seul fichier `.tsx` sous `apps/` (`apps/api/app/layout.tsx`), et
 * le grep exhaustif du 2026-09-15 rend UNE SEULE occurrence pour chacun des
 * trois — leur propre déclaration. Zéro appelant, zéro import, zéro témoin.
 *
 * Ce module reste la couche de localisation de l'API (les `*Label` ci-dessous),
 * pas un fourre-tout de rendu. Un utilitaire d'affichage qui reviendrait ici
 * devrait d'abord avoir un appelant : un composant sans consommateur n'existe
 * pas, quelle que soit la qualité de son code.
 */

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
export { EMPLOYMENT_LABELS } from '@catwalks/db/presentation';
export const employmentTermLabel = (value: string | null | undefined) => employmentLabel('employmentTerm', value);
export const workTimeLabel = (value: string | null | undefined) => employmentLabel('workTime', value);
export const programTypeLabel = (value: string | null | undefined) => employmentLabel('programType', value);
export const engagementTypeLabel = (value: string | null | undefined) => employmentLabel('engagementType', value);
export const workplaceTypeLabel = (value: string | null | undefined) => employmentLabel('workplaceType', value);
