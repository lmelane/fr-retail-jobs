"""LES TÉMOINS D-484 §1 (FICHE WORKDAY REFUSÉE S22) ÉCHOUENT SANS LEUR GARDE (30/09/2026) — preuve rejouable.

    python3 audits/2026-09-30/scripts/workday-s22-temoins-sans-correctif.py

Pour chaque garde du lot (transport, reconnaissance de la preuve, classement, décision, garde de masse, lecteur hors
ligne), le programme la retire dans la copie de travail, lance les témoins, puis RESTAURE LE FICHIER DEPUIS SA COPIE
EN MÉMOIRE et vérifie qu'il est identique octet pour octet. Il n'appelle ni `git checkout`, ni `git stash`, ni
`git show` ; il refuse de démarrer sur une copie modifiée (`git status`, lecture seule). Aucune base, aucun réseau.
Résultat du 30/09 : `audits/2026-09-30/workday-s22-temoins-sans-correctif.txt`."""
import hashlib, os, re, subprocess, sys

WT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
APP = WT + '/apps/aggregator'
VITEST = WT + '/node_modules/.bin/vitest'
W = 'apps/aggregator/src/ats/adapters/workday.ts'
H = 'apps/aggregator/src/lib/http.ts'
P = 'apps/aggregator/src/pipeline/publicationDisposition.ts'
G = 'apps/aggregator/src/pipeline/health.ts'
R = 'apps/aggregator/src/publication/recovery.ts'
S22 = 'src/ats/adapters/workday.s22.test.ts'
HTTP = 'src/lib/http.retry.test.ts'
NATIVE = 'src/lib/nativeRetention.test.ts'
UNVER = 'src/pipeline/unverifiable.test.ts'

CASES = [
  ('adaptateur : refus S22 non reconnu (retenue à instruire comme avant)', W,
   "          if (refusal) return { ...job, publicationHold: WORKDAY_DETAIL_PERMISSION_DENIED,",
   "          if (false && refusal) return { ...job, publicationHold: WORKDAY_DETAIL_PERMISSION_DENIED,", [S22]),
  ('adaptateur : preuve réduite au seul statut 403', W,
   "  if (status !== 403 || typeof body !== 'string') return undefined;",
   "  if (status === 403) return { ...S22 };\n  if (typeof body !== 'string') return undefined;", [S22]),
  ('adaptateur : statut non vérifié (corps S22 sous 500 accepté)', W,
   "  if (status !== 403 || typeof body !== 'string') return undefined;",
   "  if (typeof body !== 'string') return undefined;", [S22]),
  ('transport : corps du refus non gardé', H,
   "      const errorBody = await errorBodyExcerpt(response);",
   "      const errorBody = (await response.body?.cancel(), undefined);", [S22, HTTP]),
  ('transport : corps énumérable (recopié au journal)', H,
   "    Object.defineProperty(this, 'body', { value: body, enumerable: false });",
   "    Object.defineProperty(this, 'body', { value: body, enumerable: true });", [HTTP]),
  ('transport : corps non borné', H,
   "export const ERROR_BODY_MAX_BYTES = 4096;",
   "export const ERROR_BODY_MAX_BYTES = 4_000_000;", [HTTP]),
  ('classement : motif absent des preuves de la source', P,
   "  'NATIVE_DESCRIPTION_EMPTY', 'WORKDAY_DETAIL_PERMISSION_DENIED',\n]);",
   "  'NATIVE_DESCRIPTION_EMPTY',\n]);", [NATIVE, UNVER]),
  ('classement : décision D-484 §1 non attachée', P,
   "  WORKDAY_DETAIL_PERMISSION_DENIED: 'D-484 §1',\n",
   "", [NATIVE]),
  ('garde de masse supprimée', G,
   "    if (refused > bound) {",
   "    if (refused > bound * 1000) {", [NATIVE]),
  ('garde de masse à la borne incluse (5 sur 100 bloquant)', G,
   "    if (refused > bound) {",
   "    if (refused >= bound) {", [NATIVE]),
  ('lecteur hors ligne : preuve conservée ignorée', R,
   "        if (raw.detail === undefined && retainedWorkdayRefusal(raw)) return failure('PUBLICATION_HELD');",
   "        if (false) return failure('PUBLICATION_HELD');", [S22]),
  ('lecteur hors ligne : toute trace de refus acceptée comme preuve', W,
   "  return !!refusal && typeof refusal === 'object' && Object.keys(refusal).length === 3",
   "  return !!refusal || typeof refusal === 'object' && Object.keys(refusal).length === 3", [S22]),
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

originals = {}
for path in {c[1] for c in CASES}:
    data = open(os.path.join(WT, path), 'rb').read()
    originals[path] = (data, hashlib.sha256(data).hexdigest())

results = []
for label, path, old, new, witnesses in CASES:
    full = os.path.join(WT, path)
    data, digest = originals[path]
    text = data.decode('utf8')
    if text.count(old) != 1:
        print(f'REFUSED: pattern for « {label} » found {text.count(old)} times'); sys.exit(3)
    open(full, 'w', encoding='utf8').write(text.replace(old, new))
    try:
        out = run([VITEST, 'run', *witnesses], APP)
        files, tests, failed = summary(out.stdout + out.stderr)
        results.append((label, out.returncode, files, tests, sorted({f'{f} > {t[:100]}' for f, t in failed})))
    finally:
        open(full, 'wb').write(data)
    if hashlib.sha256(open(full, 'rb').read()).hexdigest() != digest:
        print(f'ABORT: {path} differs from its in-memory copy after restoring'); sys.exit(4)

for path, (_, digest) in sorted(originals.items()):
    print(f'{path} restauré depuis la mémoire à chaque cas, sha256 {digest}')
for label, code, files, tests, failed in results:
    verdict = 'ÉCHOUE (témoin valide)' if code != 0 else 'PASSE — TÉMOIN INOPÉRANT'
    print(f'\n## {label}: {verdict}\n   files: {files} | tests: {tests}')
    for f in failed[:6]: print(f'   - {f}')

# Contre-épreuve : tout repasse au vert sur l'état committé, et la copie est propre.
out = run([VITEST, 'run', S22, HTTP, NATIVE, UNVER], APP)
files, tests, _ = summary(out.stdout + out.stderr)
print(f'\n## état committé : exit {out.returncode} | files: {files} | tests: {tests}')
print('tree clean:', not run(['git', 'status', '--porcelain'], WT).stdout.strip())
