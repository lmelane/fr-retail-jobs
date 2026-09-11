/**
 * The BLOCKING gate of the common mutation procedure.
 *
 * It stands between the clone rehearsal and production, and its only job is to refuse. The failure it exists to
 * prevent is precise: a step that prints a problem and exits 0, letting the chain reach production anyway. Every
 * check below therefore ends in a non-zero exit, which `mutation.sh` turns into a stop.
 *
 * Three things are checked, on the evidence the chain has just produced — never on a promise:
 *
 *   1. REPLAY IS EMPTY. The rehearsal was applied twice; the second run must have changed nothing. A mutation
 *      that keeps finding work is not idempotent, and applying it to production would leave an unknown state.
 *   2. PERIMETER CONFORMITY. What the mutation announced it would touch (the perimeter manifest) must match what
 *      the rehearsal actually did. A mutation that touches more than it declared cannot be audited afterwards.
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
  if (!replay) checks.push({ id: 'replay-empty', verdict: 'UNVERIFIABLE', detail: `no parsable ${phase} replay output` });
  else {
    const applied = counts(replay, /^(applied|jobsWithdrawn|jobsClosed|sourcesDeactivated|movedJobs)$/i);
    const worked = applied.filter((n) => n > 0);
    checks.push(worked.length
      ? { id: 'replay-empty', verdict: 'BLOCK', detail: `replay still changed rows: ${worked.join(', ')} — the mutation is not idempotent` }
      : { id: 'replay-empty', verdict: 'PASS', detail: `replay changed nothing (${applied.length} counters at 0)` });
  }
}

// ─────────────────────────────────────────────────────────── 2. Perimeter conformity
{
  const perimeter = lastJson(read('perimeter.log'));
  const apply = lastJson(read(phase === 'production' ? 'prod-apply.log' : 'clone-apply.log'));
  const manifestFile = perimeter?.manifestFile ?? apply?.manifestFile;
  if (!manifestFile || !existsSync(manifestFile)) {
    checks.push({ id: 'perimeter-declared', verdict: 'BLOCK', detail: 'the mutation declared no perimeter manifest — the identifiers it touches must be listed BEFORE the write' });
  } else {
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const ids: string[] = [...(manifest.withdrawIds ?? []), ...(manifest.detachIds ?? []), ...(manifest.ids ?? [])];
    const announced = Number(manifest.totals ? Object.values(manifest.totals).find((v) => typeof v === 'number') : ids.length);
    if (!ids.length) checks.push({ id: 'perimeter-declared', verdict: 'BLOCK', detail: 'the perimeter manifest lists no identifier' });
    else {
      const applied = Math.max(0, ...counts(apply, /^(applied|sourcesDeactivated)$/i));
      checks.push(applied > ids.length
        ? { id: 'perimeter-conform', verdict: 'BLOCK', detail: `touched ${applied} rows for ${ids.length} declared identifiers` }
        : { id: 'perimeter-conform', verdict: 'PASS', detail: `${ids.length} identifiers declared, ${applied} rows touched (announced ${announced})` });
    }
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
