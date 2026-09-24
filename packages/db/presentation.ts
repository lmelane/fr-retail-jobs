import facetLabels from "./data/facet-labels.json" with { type: "json" };
import employment from "./data/employment-labels.json" with { type: "json" };

/** Libellés d'interface uniquement : aucune traduction du contenu source ni mutation des valeurs. */
export const LANGUES_LIBELLES = ["fr", "en", "de", "it", "nl", "es", "zh", "ar", "cs", "da", "el", "hu", "ja", "ko", "ms", "nb", "pl", "pt-BR", "pt", "ro", "sv", "th", "tr", "vi", "zh-Hant"] as const;
export const FACET_LABELS = facetLabels;
export type LangueLibelles = (typeof LANGUES_LIBELLES)[number];
export type DimensionEmploi = keyof (typeof employment)["fr"];

export const EMPLOYMENT_LABELS: Record<LangueLibelles, Record<DimensionEmploi, Record<string, string>>> = employment;

/** La langue des libellés pour une étiquette BCP 47 (`en-US` → `en`) ; le français quand aucun catalogue n'existe. */
export function langueDesLibelles(locale: string | null | undefined): LangueLibelles {
  if (!locale?.trim()) return "fr";
  try {
    const etiquette = new Intl.Locale(locale.trim());
    if (etiquette.language === "zh") return etiquette.script === "Hant" || ["HK", "TW", "MO"].includes(etiquette.region ?? "") ? "zh-Hant" : "zh";
    if (etiquette.language === "pt" && etiquette.region === "BR") return "pt-BR";
    return (LANGUES_LIBELLES as readonly string[]).includes(etiquette.language) ? etiquette.language as LangueLibelles : "fr";
  } catch { return "fr"; }
}

export function employmentLabel(
  dimension: DimensionEmploi,
  value: string | null | undefined,
  langue: LangueLibelles = "fr",
  pays?: string | null,
): string | null {
  if (!value) return null;
  if (pays === "CA" && langue === "fr" && dimension === "programType" && value === "APPRENTICESHIP") return "Apprentissage";
  if (pays === "CA" && langue === "fr" && dimension === "employmentTerm") {
    const canadiens: Record<string, string> = { PERMANENT: "Permanent", FIXED_TERM: "Durée déterminée", TEMPORARY: "Temporaire" };
    return canadiens[value] ?? null;
  }
  return EMPLOYMENT_LABELS[langue][dimension][value] ?? null;
}
