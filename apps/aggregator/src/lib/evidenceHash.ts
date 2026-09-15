import { createHash } from 'node:crypto';

export function evidenceHash(value: unknown): string {
  const stable = (v: unknown): unknown => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(stable)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
