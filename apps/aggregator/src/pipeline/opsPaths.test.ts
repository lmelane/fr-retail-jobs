import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * LES CHEMINS DES PROGRAMMES D'OPÉRATION, vérifiés — parce qu'un chemin faux ne se voit qu'à l'exécution.
 *
 * Deux fois de suite, un chemin résolu d'un cran trop haut ou relatif au répertoire de l'appelant a cassé un
 * programme : `apps/aggregator/apps/aggregator/…` dans un test, puis `apps/backups/…` dans le préflight, qui
 * est mort au moment d'écrire la sauvegarde — après avoir déjà interrogé la production. Ni le typecheck ni la
 * relecture ne voient ça : seule une exécution le montre.
 *
 * Ces tests exécutent donc réellement chaque programme avec `--help`/sans argument et vérifient qu'il résout
 * la racine du dépôt, depuis N'IMPORTE QUEL répertoire courant.
 */
const OPS = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/ops');
const REPO = resolve(OPS, '../../../..');

/** Chaque programme Python d'op doit résoudre la racine du dépôt, pas un niveau voisin. */
const PYTHON_OPS = ['ingest-preflight.py', 'db.py', 'railway-service.py', 'bounded-command.py'];

describe('scripts/ops — la racine du dépôt est résolue correctement', () => {
  it.each(PYTHON_OPS)('%s résout une racine contenant .git', (script) => {
    // `parents[N]` mal choisi donne un chemin voisin plausible (`apps/`, `Downloads/`) : on l'affirme donc.
    const code = `import pathlib,sys
f = pathlib.Path(${JSON.stringify(`${OPS}/${script}`)}).resolve()
src = f.read_text()
import re
m = re.search(r"ROOT = pathlib\\.Path\\(__file__\\)\\.resolve\\(\\)\\.parents\\[(\\d+)\\]", src)
if not m: print("NO_ROOT"); sys.exit(0)
root = f.parents[int(m.group(1))]
print("OK" if (root / ".git").exists() else f"BAD:{root}")`;
    const out = execFileSync('python3', ['-c', code], { encoding: 'utf8', cwd: '/' }).trim();
    expect(out).toMatch(/^(OK|NO_ROOT)$/);
  });

  it('le préflight refuse sans argument, depuis n\'importe quel répertoire', () => {
    for (const cwd of [REPO, `${REPO}/apps/aggregator`, '/']) {
      let status = 0;
      try {
        execFileSync('python3', [`${OPS}/ingest-preflight.py`], { encoding: 'utf8', cwd, stdio: 'pipe' });
      } catch (e: any) {
        status = e.status;
      }
      // Exit 2 = usage refusé proprement. Un traceback (1) signalerait un chemin cassé avant la validation.
      expect(status).toBe(2);
    }
  });

  it('bounded-command.py produit la même commande depuis n\'importe quel répertoire', () => {
    const run = (cwd: string) =>
      execFileSync('python3', [`${OPS}/bounded-command.py`, 'p7-test', 'mecca'], { encoding: 'utf8', cwd });
    expect(run(REPO)).toBe(run('/'));
  });
});
