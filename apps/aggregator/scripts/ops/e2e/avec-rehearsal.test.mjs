import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const launcher = new URL('./avec-rehearsal.sh', import.meta.url).pathname;
const fixture = { PGHOST: '127.0.0.1', PGPORT: '12345', PGUSER: 'test', PGDATABASE: 'catwalks_consolide_rehearsal', PGPASSWORD: 'FAKE.$[secret]:@/\\' };
function run(change = {}, script = 'console.log("ENFANT_EXECUTE", new URL(process.env.DATABASE_URL).pathname)') {
  const dir = mkdtempSync(join(tmpdir(), 'cw-e2e-access-'));
  try {
    const path = join(dir, 'acces.json');writeFileSync(path, JSON.stringify({ ...fixture, ...change }), { mode: 0o600 });
    return spawnSync('bash', ['-x', launcher, process.execPath, '-e', script], { encoding: 'utf8', env: { ...process.env, CW_REHEARSAL_ACCESS: path } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('trace shell sans secret, commande réellement exécutée, connexion imposée en lecture seule', () => {
  const r = run({}, 'const u=new URL(process.env.DATABASE_URL); if(decodeURIComponent(u.password)!==process.env.PGPASSWORD || !u.searchParams.get("options").includes("read_only=on")) process.exit(12); console.log("ENFANT_EXECUTE")');
  assert.equal(r.status, 0);assert.match(r.stdout, /ENFANT_EXECUTE/);assert.ok(r.stderr.length > 0);
  assert.ok(!(r.stdout+r.stderr).includes(fixture.PGPASSWORD));
  assert.ok(!(r.stdout+r.stderr).includes(encodeURIComponent(fixture.PGPASSWORD)));
});
for (const change of [{PGHOST:'production.example'}, {PGDATABASE:'prod-rehearsal'}, {PGDATABASE:'catwalks'}, {PGPORT:'0'}, {PGPASSWORD:''}]) test(`refus ${JSON.stringify(Object.keys(change))}`, () => {
  const r=run(change);assert.equal(r.status,3);assert.ok(!r.stdout.includes('ENFANT_EXECUTE'));
});
test('transmet échec enfant', () => assert.equal(run({}, 'process.exit(7)').status, 7));
