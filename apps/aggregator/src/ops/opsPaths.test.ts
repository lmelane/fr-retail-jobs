import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** Vérifie hors réseau la résolution du dépôt par le lanceur DB, sans exécuter de commande DB. */
const OPS = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/ops');

/** Chaque programme Python d'op doit résoudre la racine du dépôt, pas un niveau voisin. */
const PYTHON_OPS = ['db.py'];

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
    expect(out).toBe('OK');
  });
});
