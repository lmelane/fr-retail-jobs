import paths from "./employment-paths.json" with { type: "json" };
/** Reviewed source paths, shared by ingestion, replay and field trust measurement. */
export const EMPLOYMENT_RAW_KEYS: readonly string[] = paths;
/** Read only declared paths and primitive text. An object is never '[object Object]'. */
export function employmentPathsAt(
  payload: Record<string, unknown>,
  key: string,
): { path: string; value: string }[] {
  const parts = key.split(".");
  let v: unknown = payload;
  for (const part of parts) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return [];
    v = (v as Record<string, unknown>)[part];
  }
  const read = (item: unknown, path: string) =>
    typeof item === "string" && item.trim()
      ? [{ path, value: item.trim() }]
      : [];
  return Array.isArray(v)
    ? v.flatMap((item, i) => read(item, `${key}[${i}]`))
    : read(v, key);
}
