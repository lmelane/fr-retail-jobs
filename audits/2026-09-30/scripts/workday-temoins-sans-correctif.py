"""LES TÉMOINS WORKDAY D-482 ÉCHOUENT SANS LEUR CORRECTIF (30/09/2026) — preuve rejouable.

    python3 audits/2026-09-30/scripts/workday-temoins-sans-correctif.py

Pour chaque garde du lot (seconde passe quand le total change, mémoire du board entre les passes, témoin de rejet
unique, relecture des lignes sans chemin, vérification du rang, garde du tri instable), le programme la retire dans la
copie de travail, lance les témoins, puis RESTAURE LE FICHIER DEPUIS SA COPIE EN MÉMOIRE et vérifie qu'il est
identique octet pour octet. Il n'écrit rien d'autre, n'appelle ni `git checkout`, ni `git stash`, ni `git show` ; il
refuse de démarrer sur une copie modifiée (`git status`, lecture seule). Aucune base, aucun réseau.
Résultat du 30/09 : `audits/2026-09-30/workday-temoins-sans-correctif.txt`."""
import hashlib, os, re, subprocess, sys

WT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
APP = WT + '/apps/aggregator'
VITEST = WT + '/node_modules/.bin/vitest'
A = 'apps/aggregator/src/ats/adapters/workday.ts'
RECON = 'src/ats/adapters/workday.reconciliation.test.ts'
REPLAY = 'src/ats/adapters/workday.reconciliation.replay.test.ts'
ENUM = 'src/ats/adapters/workday.enumeration.test.ts'

CASES = [
  ('seconde passe supprimée (le total change, la preuve reste refusée)',
   "  if (!first.totalChanged || first.termination === 'PAGE_BUDGET_EXHAUSTED') return first;",
   "  if (first) return first;", [RECON, REPLAY]),
  ('mémoire du board supprimée (la seconde passe compte la première comme chevauchement)',
   "    if (memory.ids.has(externalId)) return true;\n",
   "", [RECON, REPLAY]),
  ('témoin de rejet ré-enregistré à chaque passe',
   "        if (inPass > (memory.pathlessWitnesses.get(hash) ?? 0)) {",
   "        if (inPass > 0) {", [RECON]),
  ('relecture des lignes sans chemin supprimée (contenu compté une fois)',
   "  if (repeatedContent.length && repeatedIds === 0 && !totalChanged && termination !== 'PAGE_BUDGET_EXHAUSTED') {",
   "  if (false && repeatedContent.length) {", [RECON, REPLAY]),
  ('rang non vérifié (comptage naïf par occurrence)',
   "      if (kept && !totalChanged) distinctByRank.add(hash); else",
   "      if (true) distinctByRank.add(hash); else", [RECON]),
  ('relecture même sur un tri instable (garde des identifiants répétés retirée)',
   "  if (repeatedContent.length && repeatedIds === 0 && !totalChanged",
   "  if (repeatedContent.length && !totalChanged", [ENUM]),
]

def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)

def summary(out):
    files = re.findall(r'Test Files\s+(.*)', out)
    tests = re.findall(r'Tests\s+(.*)', out)
    failed = re.findall(r'(?:×|FAIL)\s+(\S+\.test\.ts)\s*>\s*(.*)', out)
    return (files[-1].strip() if files else '?'), (tests[-1].strip() if tests else '?'), failed

if run(['git', 'status', '--porcelain'], WT).stdout.strip():
    print('REFUSED: working tree not clean before proofs'); sys.exit(2)

full = os.path.join(WT, A)
original = open(full, 'rb').read()
digest = hashlib.sha256(original).hexdigest()
text = original.decode('utf8')
results = []
for label, old, new, witnesses in CASES:
    if text.count(old) != 1:
        print(f'REFUSED: pattern for « {label} » found {text.count(old)} times'); sys.exit(3)
    open(full, 'w', encoding='utf8').write(text.replace(old, new))
    try:
        out = run([VITEST, 'run', *witnesses], APP)
        files, tests, failed = summary(out.stdout + out.stderr)
        results.append((label, out.returncode, files, tests, sorted({f'{f} > {t[:100]}' for f, t in failed})))
    finally:
        open(full, 'wb').write(original)
    if hashlib.sha256(open(full, 'rb').read()).hexdigest() != digest:
        print(f'ABORT: {A} differs from its in-memory copy after restoring'); sys.exit(4)

print(f'workday.ts restauré depuis la mémoire à chaque cas, sha256 {digest}')
for label, code, files, tests, failed in results:
    verdict = 'ÉCHOUE (témoin valide)' if code != 0 else 'PASSE — TÉMOIN INOPÉRANT'
    print(f'\n## {label}: {verdict}\n   files: {files} | tests: {tests}')
    for f in failed[:6]: print(f'   - {f}')

# Contre-épreuve : tout repasse au vert sur l'état committé, et la copie est propre.
out = run([VITEST, 'run', RECON, REPLAY, ENUM], APP)
files, tests, _ = summary(out.stdout + out.stderr)
print(f'\n## état committé : exit {out.returncode} | files: {files} | tests: {tests}')
print('tree clean:', not run(['git', 'status', '--porcelain'], WT).stdout.strip())
