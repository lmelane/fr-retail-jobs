import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The gate is the one component of the mutation procedure whose whole value is REFUSING. Testing that it passes a
 * clean chain proves nothing on its own — these tests exist to prove it BLOCKS, with a non-zero exit, on each
 * failure it claims to catch. The precise defect they guard against: a step that prints a problem and exits 0,
 * letting the chain reach production (which is what happened on 2026-09-10).
 */
const dirs: string[] = [];
const makeLogs = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  dirs.push(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** Runs the gate exactly as mutation.sh does. Paths are resolved from this file, so the suite's cwd is irrelevant. */
const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const GATE = join(REPO, 'apps/aggregator/scripts/ops/gate.mts');
const runGate = (dir: string, phase = 'clone') => {
  try {
    const stdout = execFileSync('npx', ['tsx', GATE, dir, '--name=test', `--phase=${phase}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: REPO });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (e: any) {
    return { exitCode: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
};

const manifest = (dir: string, ids: string[]) => {
  const file = join(dir, 'perimeter.json');
  writeFileSync(file, JSON.stringify({ ids, totals: { planned: ids.length } }));
  return file;
};

const cleanChain = (dir: string, file: string) => ({
  'perimeter.log': JSON.stringify({ manifestFile: file, planned: 2 }, null, 1),
  'clone-apply.log': JSON.stringify({ manifestFile: file, applied: 2, touchedIds: ['a', 'b'], jobsWithdrawn: 2, jobsClosed: 0 }, null, 1),
  'clone-replay.log': JSON.stringify({ manifestFile: file, applied: 0, touchedIds: [], jobsWithdrawn: 0, jobsClosed: 0 }, null, 1),
  'before.log': JSON.stringify({ active: 100, without_active_source: 5 }, null, 1),
  'clone-state.log': JSON.stringify({ active: 98, without_active_source: 5 }, null, 1),
});

describe('the mutation gate blocks the chain', () => {
  it('clears a rehearsal that is idempotent, in perimeter and invariant-clean', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-')); dirs.push(dir);
    const file = manifest(dir, ['a', 'b']);
    for (const [n, b] of Object.entries(cleanChain(dir, file))) writeFileSync(join(dir, n), b);
    const r = runGate(dir);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain('"verdict": "CLEARED"');
  });

  it('BLOCKS when the replay still changed rows — the mutation is not idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-')); dirs.push(dir);
    const file = manifest(dir, ['a', 'b']);
    const files = cleanChain(dir, file);
    files['clone-replay.log'] = JSON.stringify({ manifestFile: file, applied: 3, touchedIds: ['a', 'b', 'z'], jobsWithdrawn: 0, jobsClosed: 0 }, null, 1);
    for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, n), b);
    const r = runGate(dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/replay still touched \d+ identifier/);
    expect(r.stderr).toMatch(/not idempotent/);
  });

  it('BLOCKS when more rows were touched than the perimeter declared', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-')); dirs.push(dir);
    const file = manifest(dir, ['a', 'b']);
    const files = cleanChain(dir, file);
    files['clone-apply.log'] = JSON.stringify({ manifestFile: file, applied: 9, touchedIds: ['a', 'b', 'x1', 'x2'], jobsWithdrawn: 9, jobsClosed: 0 }, null, 1);
    for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, n), b);
    const r = runGate(dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/touched outside the declared perimeter/);
  });

  it('BLOCKS when a withdrawal closed postings — an administrative removal is never an employer closure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-')); dirs.push(dir);
    const file = manifest(dir, ['a', 'b']);
    const files = cleanChain(dir, file);
    files['clone-apply.log'] = JSON.stringify({ manifestFile: file, applied: 2, touchedIds: ['a', 'b'], jobsWithdrawn: 1, jobsClosed: 1 }, null, 1);
    for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, n), b);
    const r = runGate(dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/CLOSED during a withdrawal/);
  });

  it('BLOCKS when postings lost their last live attestation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-')); dirs.push(dir);
    const file = manifest(dir, ['a', 'b']);
    const files = cleanChain(dir, file);
    files['clone-state.log'] = JSON.stringify({ active: 98, without_active_source: 12 }, null, 1);
    for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, n), b);
    const r = runGate(dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/without any live attestation rose 5 → 12/);
  });

  it('BLOCKS when the mutation declared no perimeter at all', () => {
    const dir = makeLogs({
      'perimeter.log': JSON.stringify({ planned: 2 }, null, 1),
      'clone-apply.log': JSON.stringify({ applied: 2, touchedIds: ['a', 'b'], jobsWithdrawn: 2, jobsClosed: 0 }, null, 1),
      'clone-replay.log': JSON.stringify({ applied: 0, touchedIds: [] }, null, 1),
      'before.log': JSON.stringify({ without_active_source: 5 }, null, 1),
      'clone-state.log': JSON.stringify({ without_active_source: 5 }, null, 1),
    });
    const r = runGate(dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/declared no perimeter manifest/);
  });

  it('BLOCKS a replay that reports no touchedIds — a missing declaration is not zero', () => {
    // Reported by review 2026-09-11: a replay log of `{}` cleared the gate, because "no counter" was read as
    // "no write". Missing evidence must never become a pass.
    const dir = mkdtempSync(join(tmpdir(), 'gate-')); dirs.push(dir);
    const file = manifest(dir, ['a', 'b']);
    const files = cleanChain(dir, file);
    files['clone-replay.log'] = '{\n}\n';
    for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, n), b);
    const r = runGate(dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/declared no `touchedIds`/);
  });

  it('BLOCKS identifiers outside the perimeter even when the COUNT matches', () => {
    // Reported by review 2026-09-11: declaring A,B and touching C,D cleared the gate because only numbers were
    // compared. Set inclusion is the only honest check.
    const dir = mkdtempSync(join(tmpdir(), 'gate-')); dirs.push(dir);
    const file = manifest(dir, ['A', 'B']);
    const files = cleanChain(dir, file);
    files['clone-apply.log'] = JSON.stringify({ manifestFile: file, applied: 2, touchedIds: ['C', 'D'], jobsWithdrawn: 2, jobsClosed: 0 }, null, 1);
    for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, n), b);
    const r = runGate(dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/touched outside the declared perimeter: C, D/);
  });

  it('treats a check it cannot evaluate as BLOCKING, never as a pass', () => {
    // "I could not look" and "I looked and it was fine" must not produce the same verdict.
    const dir = makeLogs({ 'clone-apply.log': 'not json at all' });
    const r = runGate(dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/UNVERIFIABLE/);
  });
});
