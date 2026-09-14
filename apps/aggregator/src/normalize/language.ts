/**
 * La LANGUE DE L'ANNONCE, en code primaire BCP 47 (`fr`, `en`, `nl`).
 *
 * ── CE QUE CE MODULE NORMALISE, ET CE QU'IL NE FAIT PAS ───────────────────
 *
 * Il réduit une étiquette de langue à sa SOUS-BALISE PRIMAIRE : « fr-FR »,
 * « fr_BE », « FR » donnent tous `fr`. C'est ce dont la recherche a besoin —
 * une annonce rédigée en français l'est, que le portail la serve en `fr-FR` ou
 * `fr-BE`.
 *
 * Il ne dit RIEN du marché ni du pays : une annonce française peut être
 * rédigée en anglais, et une annonce belge en néerlandais. `langue ≠ marché`
 * est une distinction de modèle, pas un détail d'implémentation.
 *
 * ── POURQUOI IL EXISTE ────────────────────────────────────────────────────
 *
 * Trois adaptateurs portaient chacun leur copie de ce découpage :
 * `lvmhAlgolia.ts` (avec un cas `sp` → `es`), `smartrecruiters.ts` (sans ce
 * cas) et `phenom.ts` — qui lisait la langue pour compter les variantes mais
 * ne l'écrivait pas dans l'offre.
 *
 * Trois copies divergent toujours : celle de LVMH connaissait déjà une
 * correspondance que les autres ignoraient. Un seul endroit à corriger.
 */

/**
 * Étiquettes non conformes rencontrées dans les flux, et leur code réel.
 *
 * `sp` vient du flux LVMH, où il désigne l'espagnol ; BCP 47 attend `es`.
 * Cette table ne contient QUE des valeurs observées dans des réponses
 * conservées — jamais des variantes supposées.
 */
const ETIQUETTES_NON_CONFORMES: Record<string, string> = {
  sp: 'es',
};

/**
 * Le code de langue primaire, ou `undefined` si l'étiquette n'en porte pas.
 *
 * On s'abstient plutôt que de deviner : une étiquette vide, numérique ou
 * inconnue ne devient pas une langue. Une case vide se répare ; une langue
 * fausse oriente la recherche du candidat vers des annonces qu'il ne lit pas.
 */
export function normalizeLanguage(raw?: string | null): string | undefined {
  const primaire = (raw ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (!primaire) return undefined;
  // BCP 47 : une sous-balise primaire fait 2 ou 3 lettres, jamais de chiffres.
  if (!/^[a-z]{2,3}$/.test(primaire)) return undefined;
  return ETIQUETTES_NON_CONFORMES[primaire] ?? primaire;
}
