/** Interpretation is versioned separately from immutable source observations. */
export { FACT_READER_VERSION, type FactStatus, type Evidence, type Fact } from '@catwalks/db/source-facts';
export const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
export function at(raw: unknown, path: string): unknown {
  return path.split('/').filter(Boolean).reduce<unknown>((value, key) => Array.isArray(value) && /^\d+$/.test(key) ? value[Number(key)] : object(value)?.[key], raw);
}
