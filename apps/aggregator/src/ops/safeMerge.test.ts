import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * LA GARDE DE FUSION — reproduire le cas qui a invalidé T2.
 *
 * Deux fois le même accident : un déploiement déclenché pendant un run borné, le conteneur remplacé, le run
 * tué. En P7 (2026-09-09) puis en P8 (2026-09-13, `PipelineRun` INTERRUPTED à 88,8 s d'un run de quinze
 * minutes). La cause n'est pas l'inattention : c'est une règle de prudence qu'AUCUN mécanisme n'applique.
 *
 * On teste donc que la garde REFUSE, et surtout qu'elle refuse **avant** d'appeler `gh` — un refus qui
 * déclenche quand même la fusion ne protège rien.
 */
const OPS = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/ops');
const SCRIPT = join(OPS, 'safe-merge.sh');

describe('safe-merge — refuser une fusion pendant un passage borné', () => {
  it('refuse quand un runner borné tourne encore localement', () => {
    // On simule le cas de l'incident : un processus `bounded-ingest` visible dans la table des processus.
    const dir = mkdtempSync(join(tmpdir(), 'p8-merge-'));
    const fake = join(dir, 'bounded-ingest.sh');
    writeFileSync(fake, '#!/bin/sh\nsleep 12\n');
    chmodSync(fake, 0o755);
    const child = execFileSync('sh', ['-c', `nohup sh ${fake} >/dev/null 2>&1 & echo $!`], { encoding: 'utf8' }).trim();
    try {
      let status = 0; let out = '';
      try {
        out = execFileSync('sh', [SCRIPT, '99999'], { encoding: 'utf8', stdio: 'pipe', timeout: 120_000 });
      } catch (e: any) {
        status = e.status ?? -1;
        out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      }
      expect(status).not.toBe(0);
      expect(out).toContain('FUSION REFUSÉE');
      // La preuve qui compte : aucun déploiement déclenché.
      expect(out).toContain('aucun déploiement');
    } finally {
      try { process.kill(Number(child)); } catch { /* déjà terminé */ }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it('la garde vérifie les quatre conditions, pas seulement une', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    // 1. run non terminé — critère `finishedAt IS NULL`, jamais le statut affiché.
    expect(src).toContain('running-pipeline-runs.mts');
    // 2. variables de périmètre encore posées.
    expect(src).toContain('INGEST_ONLY_KEYS');
    expect(src).toContain('REFRESH_ONLY_KEYS');
    // 3. commande bornée encore déployée.
    expect(src).toMatch(/ONLY_KEYS\*\)\s*refuse/);
    // 4. runner local actif — le cas exact de l'incident.
    expect(src).toMatch(/\[b\]ounded-ingest/);
  });

  it('appelle `gh pr merge` en DERNIER, après tous les refus', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    const lines = src.split('\n').filter((l) => l.trim() && !l.trimStart().startsWith('#'));
    // L'INVOCATION réelle est la dernière ligne exécutable : tout refus la précède nécessairement.
    // (Chercher la première occurrence de la chaîne échouerait sur le message d'usage, qui la contient.)
    const last = lines[lines.length - 1]!;
    expect(last).toMatch(/^gh pr merge "\$PR"/);
    const lastRefuse = lines.reduce((acc, l, i) => (/^\s*refuse "|\|\| refuse "|\) refuse "/.test(l) ? i : acc), -1);
    expect(lines.length - 1).toBeGreaterThan(lastRefuse);
  });

  it('exige un numéro de PR plutôt que de fusionner au hasard', () => {
    let status = 0;
    try { execFileSync('sh', [SCRIPT], { encoding: 'utf8', stdio: 'pipe' }); }
    catch (e: any) { status = e.status ?? -1; }
    expect(status).toBe(2);
  });
});
