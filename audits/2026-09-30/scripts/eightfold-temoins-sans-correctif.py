"""LES TÉMOINS EIGHTFOLD ÉCHOUENT SANS LEUR CORRECTIF (30/09/2026) — preuve rejouable.

    python3 audits/2026-09-30/scripts/eightfold-temoins-sans-correctif.py

Pour chaque correctif du lot (cadence commune, relectures après la fenêtre du pare-feu, retenue D-481 §3 et son
enregistrement), le programme le retire dans la copie de travail, lance les témoins, puis restaure le fichier
committé avec `git show HEAD:<chemin>` et vérifie que la copie est propre. Il refuse de démarrer sur une copie
modifiée et n'utilise jamais `git checkout` ni `git stash` : le seul état qu'il réécrit est celui du commit.
Aucune base, aucun réseau. Résultat du 30/09 : `audits/2026-09-30/eightfold-temoins-sans-correctif.txt`."""
import subprocess, sys, re, os

WT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
APP = WT + '/apps/aggregator'
VITEST = WT + '/node_modules/.bin/vitest'

A = 'apps/aggregator/src/ats/adapters/eightfold.ts'
R = 'apps/aggregator/src/publication/recovery.ts'
P = 'apps/aggregator/src/pipeline/publicationDisposition.ts'
K = 'apps/aggregator/src/lib/rateLimitKey.ts'
G = 'apps/aggregator/src/lib/hostGate.ts'

WAF = 'src/ats/adapters/eightfold.waf.test.ts'
REPLAY = 'src/ats/adapters/eightfold.replay.test.ts'
PACE = 'src/lib/hostGate.eightfold.test.ts'
NATIVE = 'src/lib/nativeRetention.test.ts'
UNVER = 'src/pipeline/unverifiable.test.ts'

CASES = [
  ('relecture différée des fiches supprimée', A,
   "  const recovered = new Map<number, NormalizedJob>();\n  if (!failed.length) return recovered;",
   "  const recovered = new Map<number, NormalizedJob>();\n  if (failed.length >= 0) return recovered;", [WAF, REPLAY]),
  ('relecture de la page de liste supprimée', A,
   "  try {\n    return await read();\n  } catch (error) {\n    if (gone(error)) throw error;",
   "  try {\n    return await read();\n  } catch (error) {\n    if (error) throw error;", [WAF]),
  ('404 relu comme un refus du pare-feu', A,
   "  return typeof status === 'number' && GONE.has(status);",
   "  return typeof status === 'number' && GONE.has(status) && false;", [WAF]),
  ('borne « portail en panne » supprimée', A,
   "  if (failed.length > bound) {",
   "  if (failed.length > bound * 1000) {", [WAF]),
  ('retenue non posée par le collecteur', A,
   "    ...(nativeDescriptionEmpty(data) ? { publicationHold: NATIVE_DESCRIPTION_EMPTY } : {}),",
   "    ...(false ? { publicationHold: NATIVE_DESCRIPTION_EMPTY } : {}),", [WAF, REPLAY]),
  ('classifieur : titres de rubrique non retirés (seul le vide strict)', A,
   "(htmlToPlainText(inner) ?? '').length <= SECTION_HEADING_MAX_CHARS ? ' ' : heading);",
   "(htmlToPlainText(inner) ?? '').length <= -1 ? ' ' : heading);", [WAF, REPLAY]),
  ('classifieur : champ absent pris pour un vide', A,
   "  if (typeof html !== 'string') return false;\n  const body",
   "  if (typeof html !== 'string') return true;\n  const body", [WAF]),
  ('classifieur : titre long pris pour un titre de rubrique', A,
   "const SECTION_HEADING_MAX_CHARS = 60;",
   "const SECTION_HEADING_MAX_CHARS = 600;", [WAF]),
  ('rejeu des publications : retenue non reproduite', R,
   "          if (nativeDescriptionEmpty(eightfoldDetail)) job = { ...job, publicationHold: NATIVE_DESCRIPTION_EMPTY };",
   "          if (nativeDescriptionEmpty(eightfoldDetail) && false) job = { ...job, publicationHold: NATIVE_DESCRIPTION_EMPTY };", [REPLAY]),
  ('motif non enregistré comme preuve de la source', P,
   "  'SOURCE_UNLISTED', 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL', 'NATIVE_TEST_PUBLICATION', 'NATIVE_RECRUITMENT_EVENT',\n  'NATIVE_DESCRIPTION_EMPTY',\n]);",
   "  'SOURCE_UNLISTED', 'WORKDAY_EMPLOYER_ABSENT_IN_DETAIL', 'NATIVE_TEST_PUBLICATION', 'NATIVE_RECRUITMENT_EVENT',\n]);", [WAF, NATIVE, UNVER]),
  ('motif sans décision (D-481 §3) attachée', P,
   "  NATIVE_DESCRIPTION_EMPTY: 'D-481 §3',\n};",
   "};", [WAF, NATIVE]),
  ('garde de la preuve négative non étendue', P,
   "  NATIVE_DESCRIPTION_EMPTY: 'description vide chez l’éditeur',\n};",
   "};", [NATIVE]),
  ('clé commune Eightfold supprimée', K,
   "  { test: /(^|\\.)eightfold\\.ai$/i, key: 'tenant:eightfold',",
   "  { test: /(^|\\.)eightfold-disabled\\.ai$/i, key: 'tenant:eightfold',", [PACE]),
  ('careers.kering.com hors de la clé commune', K,
   "  { test: /^careers\\.kering\\.com$/i, key: 'tenant:eightfold',",
   "  { test: /^careers-disabled\\.kering\\.com$/i, key: 'tenant:eightfold',", [PACE]),
  ('cadence plancher supprimée', K,
   "  'tenant:eightfold': 350,\n};",
   "};", [PACE]),
  ('plancher oublié par la décroissance après succès', G,
   "  const base = baseGapOf(key);\n  if (state.gapMs > base) {",
   "  const base = BASE_GAP_MS;\n  if (state.gapMs > base) {", [PACE]),
]

def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)

def summary(out):
    files = re.findall(r'Test Files\s+(.*)', out)
    tests = re.findall(r'Tests\s+(.*)', out)
    failed = re.findall(r'(?:×|FAIL)\s+(\S+\.test\.ts)\s*>\s*(.*)', out)
    return (files[-1].strip() if files else '?'), (tests[-1].strip() if tests else '?'), failed

clean = run(['git', 'status', '--porcelain'], WT).stdout.strip()
if clean:
    print('REFUSED: working tree not clean before proofs:\n' + clean); sys.exit(2)

results = []
for label, path, old, new, witnesses in CASES:
    full = os.path.join(WT, path)
    text = open(full, encoding='utf8').read()
    if text.count(old) != 1:
        print(f'REFUSED: pattern for « {label} » found {text.count(old)} times'); sys.exit(3)
    open(full, 'w', encoding='utf8').write(text.replace(old, new))
    try:
        out = run([VITEST, 'run', *witnesses], APP)
        files, tests, failed = summary(out.stdout + out.stderr)
        results.append((label, out.returncode, files, tests, sorted({f'{f} > {t[:90]}' for f, t in failed})))
    finally:
        restored = run(['git', 'show', f'HEAD:{path}'], WT).stdout
        open(full, 'w', encoding='utf8').write(restored)
    if run(['git', 'status', '--porcelain'], WT).stdout.strip():
        print(f'ABORT: tree not clean after restoring {path}'); sys.exit(4)

for label, code, files, tests, failed in results:
    verdict = 'ÉCHOUE (témoin valide)' if code != 0 else 'PASSE — TÉMOIN INOPÉRANT'
    print(f'\n## {label}: {verdict}\n   files: {files} | tests: {tests}')
    for f in failed[:6]: print(f'   - {f}')

# Contre-épreuve : tout repasse au vert sur l'état committé.
out = run([VITEST, 'run', WAF, REPLAY, PACE, NATIVE, UNVER], APP)
files, tests, _ = summary(out.stdout + out.stderr)
print(f'\n## état committé restauré : exit {out.returncode} | files: {files} | tests: {tests}')
print('tree clean:', not run(['git', 'status', '--porcelain'], WT).stdout.strip())
