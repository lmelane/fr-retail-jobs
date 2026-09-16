import { createHash } from 'node:crypto';

export const digestBytes = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export function evidenceHash(value: unknown): string {
  const stable = (v: unknown): unknown => v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(stable)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
  return digestBytes(JSON.stringify(stable(value)));
}
