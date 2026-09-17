/** Copy and freeze JSON configuration before hashing or executing a collector.
 * Execution controls belong to sourceBudget, never to the portal settings. */
export function captureConfig(config: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['deadlineMs', 'startPage', 'progress']) {
    if (Object.hasOwn(config, key)) throw new Error(`Execution control ${key} cannot be stored in source configuration`);
  }
  let nodes = 0;
  const copy = (value: unknown, depth = 0): unknown => {
    if (++nodes > 10_000 || depth > 32) throw new Error('Source configuration exceeds its structure budget');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return Object.freeze(Array.from(value, field => copy(field, depth + 1)));
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, field]) => [key, copy(field, depth + 1)])));
    }
    throw new Error('Source configuration must contain only finite JSON values');
  };
  const snapshot = copy(config);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Source configuration must be an object');
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 1_048_576) throw new Error('Source configuration exceeds 1 MiB');
  return snapshot as Record<string, unknown>;
}
