import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Le lanceur d'ÉCRITURE de la copie jetable refuse, avant tout Docker et toute connexion, un argument qui
// désignerait une autre base : une URL (`://`, `--url`, `--from-url`…) ou un autre schéma Prisma.
const launcher = fileURLToPath(new URL('./avec-copie-jetable.mjs', import.meta.url));
const depot = fileURLToPath(new URL('../../../../../', import.meta.url));
const access = { PGHOST: '127.0.0.1', PGPORT: '5555', PGUSER: 'test', PGPASSWORD: 'secret', PGDATABASE: 'catwalks_consolide_rehearsal' };
function run(args) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-copie-jetable-'));
  try {
    writeFileSync(join(dir, 'throwaway-access.json'), JSON.stringify(access), { mode: 0o600 });
    writeFileSync(join(dir, 'throwaway.port'), access.PGPORT);
    // Aucun conteneur de ce nom : un argument admis s'arrête au contrôle Docker, sans rien lancer.
    writeFileSync(join(dir, 'throwaway.name'), 'catwalks-e2e-throwaway-20000101000000');
    return spawnSync(process.execPath, [launcher, process.execPath, '-e', 'console.log("ENFANT_EXECUTE")', ...args],
      { encoding: 'utf8', cwd: depot, env: { ...process.env, CW_COPIE_JETABLE: dir } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
for (const args of [['postgresql://prod.example/railway'], ['--url', 'x'], ['--url=x'], ['--from-url', 'x'], ['--to-url=x'], ['--datasource-url', 'x']]) {
  test(`refuse une URL en argument : ${args.join(' ')}`, () => {
    const r = run(args);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /URL de base en argument interdite/);
    assert.ok(!r.stdout.includes('ENFANT_EXECUTE'));
  });
}
for (const args of [['--schema', 'autre/schema.prisma'], ['--schema=apps/aggregator/package.json'], ['--schema']]) {
  test(`refuse un autre schéma : ${args.join(' ')}`, () => {
    const r = run(args);
    assert.equal(r.status, 3);
    assert.match(r.stderr, /seul le schéma packages\/db\/prisma\/schema\.prisma est admis/);
    assert.ok(!r.stdout.includes('ENFANT_EXECUTE'));
  });
}
for (const args of [['--schema', 'packages/db/prisma/schema.prisma'], ['--schema=./packages/db/prisma/schema.prisma']]) {
  test(`admet le schéma du dépôt, puis s'arrête au contrôle du conteneur : ${args.join(' ')}`, () => {
    const r = run(args);
    // Prémisse : l'argument a passé les contrôles, c'est Docker (conteneur absent) qui arrête le lanceur.
    assert.equal(r.status, 3);
    assert.doesNotMatch(r.stderr, /URL de base|seul le schéma/);
    assert.match(r.stderr, /conteneur catwalks-e2e-throwaway-20000101000000 introuvable/);
    assert.ok(!r.stdout.includes('ENFANT_EXECUTE'));
  });
}
