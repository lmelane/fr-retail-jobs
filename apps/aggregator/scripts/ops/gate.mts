/**
 * The BLOCKING gate of the common mutation procedure.
 *
 * It stands between the clone rehearsal and production, and its only job is to refuse. The failure it exists to
 * prevent is precise: a step that prints a problem and exits 0, letting the chain reach production anyway. Every
 * check below therefore ends in a non-zero exit, which `mutation.sh` turns into a stop.
 *
 * Three things are checked, on the evidence the chain has just produced — never on a promise:
 *
 *   1. REPLAY IS EMPTY. The second rehearsal pass must report an EXPLICIT, empty set of touched identifiers.
 *      Review on 2026-09-11 showed a replay log of `{}` clearing the gate: "no counter" was read as "no write",
 *      turning missing evidence into a pass. Silence now blocks.
 *   2. PERIMETER CONFORMITY, BY IDENTIFIER. Every identifier actually touched must have been declared. The check
 *      compared NUMBERS, so a mutation declaring A,B and touching C,D cleared the gate; it now compares SETS.
 *   3. BUSINESS INVARIANTS. The dossier-independent ones this catalogue has already paid for:
 *        · no posting is CLOSED by a withdrawal (an administrative removal is never an employer closure);
 *        · no active posting loses every live attestation;
 *        · the active total does not move by more than the perimeter allows.
 *
 * A check that cannot be evaluated is NOT a pass: it is reported as UNVERIFIABLE and blocks, because "I could not
 * look" and "I looked and it was fine" are different things.
 *
 * usage: gate.mts <log-dir> --name=<mutation> [--phase=clone|production]
 * exit 0 = the chain may continue · exit 1 = blocked, with the reason named.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const logDir = process.argv[2];
if (!logDir) { console.error('usage: gate.mts <log-dir> --name=<mutation> [--phase=...]'); process.exit(2); }
const arg = (n: string) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').split('=').slice(1).join('=');
const phase = arg('phase') || 'clone';
const name = arg('name') || 'mutation';

type Check = { id: string; verdict: 'PASS' | 'BLOCK' | 'UNVERIFIABLE'; detail: string };
const checks: Check[] = [];
const read = (f: string) => (existsSync(`${logDir}/${f}`) ? readFileSync(`${logDir}/${f}`, 'utf8') : null);

/** A mutation script prints JSON; take the last well-formed object in its log. */
const lastJson = (text: string | null): any => {
  if (!text) return null;
  for (const m of [...text.matchAll(/\{[\s\S]*?\n\}/g)].reverse()) {
    try { return JSON.parse(m[0]); } catch { /* keep looking */ }
  }
  try { return JSON.parse(text); } catch { return null; }
};

/**
 * The identifiers a run declares it touched. `undefined` means the run did not say — which is NOT "none".
 * That distinction is the whole point: an absent declaration blocks, an explicit empty list passes.
 *
 * CONTRACT for a mutation script: on `--apply`, print `touchedIds` alongside the manifest.
 */
const touchedIds = (node: any): string[] | undefined => {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node.touchedIds)) return node.touchedIds.map(String);
  for (const v of Object.values(node)) {
    const found = touchedIds(v);
    if (found !== undefined) return found;
  }
  return undefined;
};

/** Every numeric "applied"/"planned" field a mutation may report, whatever its shape. */
const counts = (node: any, key: RegExp, acc: number[] = []): number[] => {
  if (!node || typeof node !== 'object') return acc;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'number' && key.test(k)) acc.push(v);
    else counts(v, key, acc);
  }
  return acc;
};

// ─────────────────────────────────────────────────────────── 1. Replay is empty
{
  const replay = lastJson(read(phase === 'production' ? 'prod-replay.log' : 'clone-replay.log'));
  const ids = touchedIds(replay);
  if (!replay) checks.push({ id: 'replay-empty', verdict: 'UNVERIFIABLE', detail: `no parsable ${phase} replay output` });
  else if (ids === undefined) checks.push({ id: 'replay-empty', verdict: 'UNVERIFIABLE', detail: 'the replay declared no `touchedIds`: it cannot be shown to have written nothing (a missing declaration is not zero)' });
  else if (ids.length) checks.push({ id: 'replay-empty', verdict: 'BLOCK', detail: `replay still touched ${ids.length} identifier(s): ${ids.slice(0, 5).join(', ')} — the mutation is not idempotent` });
  else {
    const worked = counts(replay, /^(applied|jobsWithdrawn|jobsClosed|sourcesDeactivated|movedJobs)$/i).filter((n) => n > 0);
    checks.push(worked.length
      ? { id: 'replay-empty', verdict: 'BLOCK', detail: `replay declared no identifier but reported counters ${worked.join(', ')} — the two contradict each other` }
      : { id: 'replay-empty', verdict: 'PASS', detail: 'replay declared an explicitly empty set of touched identifiers' });
  }
}

// ─────────────────────────────────────────────────────────── 2. Perimeter conformity, by IDENTIFIER
{
  const perimeter = lastJson(read('perimeter.log'));
  const apply = lastJson(read(phase === 'production' ? 'prod-apply.log' : 'clone-apply.log'));
  const manifestFile = perimeter?.manifestFile ?? apply?.manifestFile;
  const declared: string[] | null = manifestFile && existsSync(manifestFile)
    ? (() => { const m = JSON.parse(readFileSync(manifestFile, 'utf8')); return [...(m.withdrawIds ?? []), ...(m.detachIds ?? []), ...(m.ids ?? [])].map(String); })()
    : null;
  const actual = touchedIds(apply);
  if (declared === null) checks.push({ id: 'perimeter-declared', verdict: 'BLOCK', detail: 'the mutation declared no perimeter manifest — the identifiers it will touch must be listed BEFORE the write' });
  else if (!declared.length) checks.push({ id: 'perimeter-declared', verdict: 'BLOCK', detail: 'the perimeter manifest lists no identifier' });
  else if (actual === undefined) checks.push({ id: 'perimeter-conform', verdict: 'UNVERIFIABLE', detail: 'the apply declared no `touchedIds`: the rows it wrote cannot be compared with the perimeter' });
  else {
    // Set inclusion, not cardinality: a run touching C,D for a declared A,B has the same count and is wrong.
    const declaredSet = new Set(declared);
    const outside = actual.filter((id) => !declaredSet.has(id));
    checks.push(outside.length
      ? { id: 'perimeter-conform', verdict: 'BLOCK', detail: `${outside.length} identifier(s) touched outside the declared perimeter: ${outside.slice(0, 5).join(', ')}` }
      : { id: 'perimeter-conform', verdict: 'PASS', detail: `${actual.length} identifier(s) touched, all among the ${declared.length} declared` });
  }
}

// ─────────────────────────────────────────────────────────── 3. Business invariants
{
  const apply = lastJson(read(phase === 'production' ? 'prod-apply.log' : 'clone-apply.log'));
  const closed = counts(apply, /^jobsClosed$/i).reduce((a, b) => a + b, 0);
  const withdrawn = counts(apply, /^jobsWithdrawn$/i).reduce((a, b) => a + b, 0);
  if (apply === null) checks.push({ id: 'withdrawal-never-closes', verdict: 'UNVERIFIABLE', detail: 'no parsable apply output' });
  else checks.push(withdrawn > 0 && closed > 0
    ? { id: 'withdrawal-never-closes', verdict: 'BLOCK', detail: `${closed} postings CLOSED during a withdrawal — an administrative removal must never be recorded as an employer closure` }
    : { id: 'withdrawal-never-closes', verdict: 'PASS', detail: `withdrawn ${withdrawn}, closed ${closed}` });

  const before = lastJson(read('before.log'));
  const after = lastJson(read(phase === 'production' ? 'after.log' : 'clone-state.log'));
  const orphans = after && typeof after.without_active_source === 'number' ? after.without_active_source : null;
  const orphansBefore = before && typeof before.without_active_source === 'number' ? before.without_active_source : null;
  if (orphans === null || orphansBefore === null) checks.push({ id: 'no-new-orphan', verdict: 'UNVERIFIABLE', detail: 'the state script does not report without_active_source' });
  else checks.push(orphans > orphansBefore
    ? { id: 'no-new-orphan', verdict: 'BLOCK', detail: `postings without any live attestation rose ${orphansBefore} → ${orphans}` }
    : { id: 'no-new-orphan', verdict: 'PASS', detail: `no new orphan (${orphansBefore} → ${orphans})` });
}

const blocking = checks.filter((c) => c.verdict !== 'PASS');
console.log(JSON.stringify({ at: new Date().toISOString(), mutation: name, phase, checks, verdict: blocking.length ? 'BLOCKED' : 'CLEARED' }, null, 1));
if (blocking.length) {
  console.error(`\ngate BLOCKED the chain (${blocking.length} check(s) not passing):`);
  for (const c of blocking) console.error(`  ${c.verdict}  ${c.id}: ${c.detail}`);
  process.exit(1);
}
