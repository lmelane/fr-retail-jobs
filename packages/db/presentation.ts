import employment from "./data/employment-labels.json";

/** Libellés d'interface uniquement : aucune traduction du contenu source ni mutation des valeurs. */
export const LANGUES_LIBELLES = ["fr", "en", "de", "it", "nl", "es", "zh"] as const;
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
