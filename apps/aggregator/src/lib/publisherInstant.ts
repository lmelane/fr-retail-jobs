/** An explicitly zoned publisher timestamp. Never interpret it in the worker's
 * local timezone or allow Date's silent rollover of an invalid calendar day. */
export function publisherInstant(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const iso = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/.exec(value);
  if (!iso) return undefined;
  const calendar = new Date(`${iso[1]}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== iso[1]) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999 ? date : undefined;
}

/** A timezone-less ISO publication date has calendar precision, never the
 * timezone of the machine running the extraction or its replay. */
export function publisherDate(value: unknown): Date | undefined {
  const instant = publisherInstant(value);
  if (instant || typeof value !== 'string') return instant;
  const calendar = /^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?)?$/.exec(value)?.[1];
  if (!calendar) return undefined;
  const date = new Date(`${calendar}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === calendar ? date : undefined;
}
