type CommandOptions = { values?: string[]; flags?: string[]; positional?: 'required' | 'optional'; requiredValues?: string[] };
/** Commands declare their accepted scope before any database or network work.
 * Unknown/empty flags must never turn a bounded request into a global run. */
const COMMANDS: Record<string, CommandOptions> = {
  ingest: { values: ['source'], flags: ['no-geocode'] },
  'ingest-all': {}, refresh: {}, reconcile: {}, 'health-report': {},
  snapshot: { values: ['date','backfill-from'] }, 'import-sources': {},
  'identity-profile': { positional: 'required' }, promote: { positional: 'required' },
  'review-source-identity': { values: ['record','artifact'], flags: ['apply'] },
  'retire-source': { positional: 'required', values: ['external-prefix'] },
  'separate-fused': {}, 'resolve-domains': { values: ['limit'], flags: ['dry-run'] },
  'apply-domain-sheet': { values: ['file'], flags: ['apply'] },
  'occupation-review-queue': { values: ['output','limit'] },
  'occupation-preview': { values: ['file','output'] },
  'occupation-activate': { values: ['file','output','review','commit'], flags: ['apply'] },
  'classify-jobs': { values: ['limit','expected-release'], flags: ['all','dry-run'] },
  geocode: {}, stats: {},
  'export-companies': { positional: 'optional' },
  discover: { values: ['input','output-dir','dead-list','limit','concurrency'], requiredValues: ['input','output-dir'], flags: ['fresh'] },
};

export function validateCliArguments(command: string, args: string[]): void {
  if (!Object.hasOwn(COMMANDS, command)) throw new Error('Unknown command');
  const spec = COMMANDS[command], seen = new Set<string>();
  let positionals = 0;
  for (const [index, arg] of args.entries()) {
    if (!arg.startsWith('-')) {
      if (!spec.positional || index !== 0 || !arg.trim() || ++positionals > 1) throw new Error('Unexpected positional argument');
      continue;
    }
    const split = arg.indexOf('='), name = (split === -1 ? arg : arg.slice(0, split)).slice(2);
    if (!arg.startsWith('--') || (!spec.values?.includes(name) && !spec.flags?.includes(name))) throw new Error('Unsupported option for this command; no work was started');
    if (seen.has(name)) throw new Error('Duplicate option');
    seen.add(name);
    if (spec.values?.includes(name) && (split === -1 || !arg.slice(split + 1).trim())) throw new Error('A nonempty --option=value is required');
    if (spec.flags?.includes(name) && split !== -1) throw new Error('Boolean flags do not accept a value');
    if (['limit','concurrency'].includes(name)) {
      const value = Number(arg.slice(split + 1));
      if (!Number.isSafeInteger(value) || value < (name === 'concurrency' ? 1 : 0)) throw new Error('Invalid numeric limit');
    }
  }
  for (const name of spec.requiredValues ?? []) if (!seen.has(name)) throw new Error(`Missing required --${name}=value`);
  if (spec.positional === 'required' && positionals !== 1) throw new Error('A source key is required');
}
