const commands = {
  register: { options: ['apply', 'out'], required: [] },
  profile: { options: ['out'], required: [] },
  identity: { options: ['artifact', 'apply', 'out'], required: ['artifact'] },
  evidence: { options: ['purpose', 'url', 'revision', 'deadline-ms', 'apply', 'out'], required: ['purpose', 'url', 'revision', 'apply'] },
  collect: { options: ['apply', 'deadline-ms', 'out'], required: ['apply'] },
  validate: { options: ['apply', 'out'], required: ['apply'] },
  promote: { options: ['revision', 'apply', 'out'], required: ['revision', 'apply'] },
  status: { options: ['out'], required: [] },
} satisfies Record<string, { options: string[]; required: string[] }>;
export type SourceCommand = keyof typeof commands;
export type SourceArguments = { command: SourceCommand; target: string; options: Record<string, string>; apply: boolean };

/** Parse before opening a database, reading a dossier or collecting any native response. */
export function parseSourceArguments(args: string[]): SourceArguments {
  const [command, target, ...flags] = args;
  if (!Object.hasOwn(commands, command ?? '') || !target?.trim() || target.startsWith('-')) {
    throw new Error('Choose source-onboard register|profile|identity|evidence|collect|validate|promote|status and one explicit target');
  }
  const spec = commands[command as SourceCommand];
  const options: Record<string, string> = {};
  for (const flag of flags) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(flag);
    if (!match || !(spec.options as string[]).includes(match[1]) || Object.hasOwn(options, match[1])) throw new Error('Unknown or duplicate source option');
    const [, name, value] = match;
    if (name === 'apply' ? value !== undefined : !value?.trim()) throw new Error('Invalid source option value');
    options[name] = value ?? 'true';
  }
  for (const name of spec.required) if (!options[name]) throw new Error(`This source operation requires --${name}${name === 'apply' ? '' : '=value'}`);
  if (command === 'evidence' && !['identity', 'access'].includes(options.purpose)) throw new Error('Evidence purpose must be identity or access');
  if (options['deadline-ms']) {
    const deadline = Number(options['deadline-ms']);
    if (!Number.isSafeInteger(deadline) || deadline < 1 || deadline > 2_147_483_647) throw new Error('Invalid collection deadline');
  }
  return { command: command as SourceCommand, target, options, apply: options.apply === 'true' };
}
