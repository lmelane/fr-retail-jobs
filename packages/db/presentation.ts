import employment from "./data/employment-labels.json";
/** Locale-specific presentation data. Internal values never become French enums. */
export const EMPLOYMENT_LABELS: Record<
  keyof typeof employment,
  Record<string, string>
> = employment;
export function employmentLabel(
  dimension: keyof typeof employment,
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return EMPLOYMENT_LABELS[dimension][value] ?? "Valeur à vérifier";
}
