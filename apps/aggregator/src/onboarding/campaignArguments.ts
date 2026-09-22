/** No empty or misspelled scope may widen an operational campaign. */
export function campaignArguments(args: string[]) {
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--(candidates|out-dir|keys|limit|deadline-ms|reviewer)=(.+)$/.exec(arg);
    const name = match?.[1] ?? (arg === '--ingest' ? 'ingest' : undefined);
    if (!name || values.has(name)) throw new Error('Unknown, duplicate or empty campaign option');
    values.set(name, match?.[2].trim() ?? 'true');
  }
  for (const name of ['candidates', 'out-dir', 'keys', 'reviewer']) if (!values.get(name)) throw new Error(`Missing --${name}`);
  const positive = (name: string, fallback: number) => {
    const text = values.get(name);
    const n = text === undefined ? fallback : Number(text);
    if ((text !== undefined && !/^\d+$/.test(text)) || !Number.isSafeInteger(n) || n <= 0) throw new Error(`Invalid --${name}`);
    return n;
  };
  const keys = values.get('keys')!.split(',');
  if (keys.some(k => !/^[a-z0-9][a-z0-9-]*$/.test(k)) || new Set(keys).size !== keys.length) throw new Error('Explicit unique source keys required');
  const reviewer = values.get('reviewer')!;
  if (reviewer.length > 160 || /[\r\n]/.test(reviewer)) throw new Error('Invalid reviewer');
  return { candidates: values.get('candidates')!, outDir: values.get('out-dir')!, reviewer, keys,
    limit: positive('limit', keys.length), deadlineMs: positive('deadline-ms', 1_800_000), ingest: values.has('ingest') };
}

export function selectCandidates<T extends { key: string }>(candidates: T[], options: ReturnType<typeof campaignArguments>): T[] {
  if (!Array.isArray(candidates) || candidates.some(c => !c || typeof c.key !== 'string')
    || new Set(candidates.map(c => c.key)).size !== candidates.length) throw new Error('Invalid or duplicate candidate list');
  if (options.keys.some(k => !candidates.some(c => c.key === k))) throw new Error('Requested source missing from candidates');
  return options.keys.slice(0, options.limit).map(key => candidates.find(c => c.key === key)!);
}
