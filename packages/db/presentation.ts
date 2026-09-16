import employment from "./data/employment-labels.json";

/**
 * Les libellés d'affichage des dimensions d'emploi, par LANGUE (lot 8).
 *
 * `fr` est la source ; `en` est une traduction d'interface du vocabulaire
 * commun de l'API, au même standard que le catalogue anglais du site. Les
 * valeurs internes (`PERMANENT`, `FULL_TIME`…) ne deviennent jamais des
 * énumérations françaises, et « CDI » n'est qu'une traduction d'affichage,
 * pas une équivalence juridique. Aucun libellé natif d'un autre marché n'est
 * inventé ici : un marché dont la langue n'a pas de catalogue reçoit le
 * français, et la réponse le dit (`perimetre.langueDesLibelles`).
 */
export const LANGUES_LIBELLES = ["fr", "en"] as const;
export type LangueLibelles = (typeof LANGUES_LIBELLES)[number];
export type DimensionEmploi = keyof (typeof employment)["fr"];

export const EMPLOYMENT_LABELS: Record<LangueLibelles, Record<DimensionEmploi, Record<string, string>>> = employment;

/** La langue des libellés pour une étiquette BCP 47 (`en-US` → `en`) ; le français quand aucun catalogue n'existe. */
export function langueDesLibelles(locale: string | null | undefined): LangueLibelles {
  const langue = locale?.trim().toLowerCase().split("-")[0];
  return (LANGUES_LIBELLES as readonly string[]).includes(langue ?? "") ? (langue as LangueLibelles) : "fr";
}

export function employmentLabel(
  dimension: DimensionEmploi,
  value: string | null | undefined,
  langue: LangueLibelles = "fr",
): string | null {
  if (!value) return null;
  return EMPLOYMENT_LABELS[langue][dimension][value] ?? EMPLOYMENT_LABELS.fr[dimension][value] ?? "Valeur à vérifier";
}
