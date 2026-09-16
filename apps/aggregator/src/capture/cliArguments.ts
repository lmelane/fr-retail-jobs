const readers = ['capture', 'observation', 'output', 'replay'] as const;
/** Reject ambiguous selections and unknown flags before opening a database or
 * starting collection. This command never writes a qualification decision. */
export function parseCaptureArguments(args: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  const allowed = [...readers, 'config', 'out'];
  for (const arg of args) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match || !allowed.includes(match[1]) || Object.hasOwn(values, match[1])) throw new Error('Unknown or duplicate capture option');
    const [, key, value] = match;
    if (!value?.trim()) throw new Error('Invalid capture option value');
    values[key] = value;
  }
  const selected = [...readers].filter(key => values[key]);
  if (selected.length !== 1) throw new Error('Choose exactly one capture operation');
  const operation = selected[0];
  if (!values.out) throw new Error('Reading native or derived content requires a private --out=<file>');
  if ((operation === 'replay') !== !!values.config) throw new Error('Only replay requires --config=<file>');
  return values;
}
