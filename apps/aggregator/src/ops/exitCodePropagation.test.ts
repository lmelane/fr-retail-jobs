import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * LA PROPAGATION DU CODE DE SORTIE — un refus doit rester un refus jusqu'à l'appelant.
 *
 * Défaut mesuré le 2026-09-13 : un préflight rendait `verdict: REFUS`, et l'appel extérieur terminait par
 * `exited with code 0`. La garde avait fonctionné ; c'est l'INVOCATION qui mentait, parce qu'elle passait la
 * sortie dans `| tail` — le code d'un tube est celui de sa dernière commande, et `tail` réussit toujours.
 *
 * Un refus déguisé en succès est pire qu'une garde absente : on enchaîne sur l'étape suivante en croyant
 * l'état vérifié. Ces tests exercent le VRAI script, pas une reformulation de sa logique.
 */
const OPS = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/ops');
const WRAPPER = join(OPS, 'run-bounded.sh');

/** Exécute le wrapper sur un faux runner et rend { code, sortie }. */
function runWrapper(script: string, args: string[] = []): { code: number; out: string; log: string } {
  const dir = mkdtempSync(join(tmpdir(), 'p8-exit-'));
  const runner = join(dir, 'runner.sh');
  const log = join(dir, 'sub', 'run.log');
  writeFileSync(runner, script);
  chmodSync(runner, 0o755);
  let code = 0; let out = '';
  try {
    out = execFileSync('sh', [WRAPPER, log, runner, ...args], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e: any) {
    code = e.status ?? -1;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  let logged = '';
  try { logged = readFileSync(log, 'utf8'); } catch { /* le journal peut ne pas exister */ }
  rmSync(dir, { recursive: true, force: true });
  return { code, out, log: logged };
}

describe('propagation du code de sortie d\'un runner borné', () => {
  it('1. préflight REFUSÉ → code non nul (le cas qui avait rendu 0)', () => {
    const r = runWrapper('#!/bin/sh\necho \'"verdict": "REFUS"\'\nexit 3\n');
    expect(r.code).toBe(3);
    expect(r.log).toContain('REFUS');
  });

  it('2. runner INTERROMPU → code non nul', () => {
    // 130 = 128 + SIGINT, la convention qu'un arrêt propre doit conserver.
    const r = runWrapper('#!/bin/sh\necho interrompu\nexit 130\n');
    expect(r.code).toBe(130);
  });

  it('3. run terminal AVEC problèmes → code non nul', () => {
    const r = runWrapper('#!/bin/sh\necho \'"problems": ["run en échec"]\'\nexit 1\n');
    expect(r.code).toBe(1);
  });

  it('4. run SAIN → code zéro', () => {
    const r = runWrapper('#!/bin/sh\necho \'"problems": []\'\nexit 0\n');
    expect(r.code).toBe(0);
    expect(r.log).toContain('problems');
  });

  it('5. journal illisible : le code du runner survit quand même', () => {
    // Le wrapper crée le dossier du journal ; on vérifie ici que l'AFFICHAGE ne peut pas changer le verdict.
    const r = runWrapper('#!/bin/sh\nexit 7\n');
    expect(r.code).toBe(7);
  });

  it('aucune commande de présentation ne remplace le code — le tube est la faute historique', () => {
    const src = readFileSync(WRAPPER, 'utf8');
    // La sortie du runner va dans un FICHIER, jamais dans un tube.
    expect(src).toMatch(/sh "\$RUNNER" "\$@" > "\$LOG" 2>&1/);
    // Le code est capturé IMMÉDIATEMENT après l'appel, avant tout affichage.
    expect(src).toMatch(/STATUS=\$\?/);
    // Et il est ré-émis tel quel.
    expect(src).toMatch(/exit "\$STATUS"/);
  });

  it('un code non nul est ANNONCÉ, pas seulement rendu', () => {
    const r = runWrapper('#!/bin/sh\nexit 5\n');
    expect(r.code).toBe(5);
    expect(r.out).toContain('ÉCHEC');
  });

  it('le contre-exemple historique : un tube AURAIT rendu 0', () => {
    // On démontre le défaut lui-même, pour que la valeur du wrapper reste lisible dans le temps.
    let piped = 0;
    try { execFileSync('sh', ['-c', '(exit 3) | tail -1'], { stdio: 'pipe' }); }
    catch (e: any) { piped = e.status ?? -1; }
    expect(piped).toBe(0); // le tube MASQUE le refus…
    expect(runWrapper('#!/bin/sh\nexit 3\n').code).toBe(3); // …le wrapper, non.
  });
});
