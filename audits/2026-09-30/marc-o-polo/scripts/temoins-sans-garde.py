"""LES TÉMOINS MARC O'POLO ÉCHOUENT SANS LEUR GARDE (D-485, 30/09/2026) — preuve rejouable.

    python3 audits/2026-09-30/marc-o-polo/scripts/temoins-sans-garde.py

Pour chaque garde du lecteur dédié, le programme la retire dans la copie de travail (remplacement en mémoire puis
écriture), lance les témoins, puis restaure le fichier committé avec `git show HEAD:<chemin>` et vérifie que la copie
est propre. Il refuse de démarrer sur une copie modifiée et n'utilise jamais `git checkout` ni `git stash`. Aucune base,
aucun réseau. Résultat : `audits/2026-09-30/marc-o-polo/temoins-sans-garde.txt`."""
import subprocess, sys, re, os

WT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
APP = WT + '/apps/aggregator'
VITEST = WT + '/node_modules/.bin/vitest'

A = 'apps/aggregator/src/ats/adapters/marcOPolo.ts'
K = 'apps/aggregator/src/lib/rateLimitKey.ts'
L = 'apps/aggregator/src/facts/locations.ts'
T = 'src/ats/adapters/marcOPolo.test.ts'
P = 'src/lib/hostGate.marc-o-polo.test.ts'

CASES = [
  ('témoin de la page publiée supprimé', A, [
    ("  const pageOnly = (published.ids ?? []).filter((id) => !listed.has(id));", "  const pageOnly: string[] = [];")], [T]),
  ('offre fermée chez l’éditeur non reconnue', A, [
    ("      else if (outcome.failure === 'DETAIL_EMPTY_AT_SOURCE') closedSinceRender++;\n", "")], [T]),
  ('API déclarée par le site non comparée', A, [
    ("  if (published.problem !== 'PAGE_FETCH_FAILED' && published.declaredApiUrl !== settings.apiUrl) issues.push('PUBLISHED_API_URL_CHANGED');", "")], [T]),
  ('page illisible sans motif', A, [
    ("  if (published.problem) issues.push(`PUBLISHED_LIST_UNREADABLE:${published.problem}`);", "")], [T]),
  ('fiche vide `{}` non distinguée', A, [
    ("  if (isRecord(detail) && Object.keys(detail).length === 0) return { failure: 'DETAIL_EMPTY_AT_SOURCE' };\n", "")], [T]),
  ('identité de la fiche non vérifiée (collecte et reprise)', A, [
    ("  if (!isRecord(detail) || detail.id !== id) return { failure: 'DETAIL_MALFORMED_IDENTITY' };", "  if (!isRecord(detail)) return { failure: 'DETAIL_MALFORMED_IDENTITY' };"),
    ("VACANCY_ID.test(listing.id) || detail.id !== listing.id ||", "VACANCY_ID.test(listing.id) ||")], [T]),
  ('relecture différée des fiches supprimée', A, [
    ("  if (detailRetryAllowed(failed.length, rows.length)) {", "  if (false && detailRetryAllowed(failed.length, rows.length)) {")], [T]),
  ('identifiant répété accepté', A, [
    ("    if (rows.some((seen) => seen.id === id)) {", "    if (false) {")], [T]),
  ('toutes les fiches en échec rendues comme une source vide', A, [
    ("    throw new Error('MARC_O_POLO_DETAILS_UNREACHABLE: aucune fiche lue');", "    void 0;")], [T]),
  ('adresse retenue non recalculée à la reprise', A, [
    ("  if (raw.pageUrl !== pageUrl) return null;\n", "")], [T]),
  ('adresse sans minuscules (≠ lien du site)', A, [
    (".replace(/\\s{1,5}/g, '-').toLowerCase();", ".replace(/\\s{1,5}/g, '-');")], [T]),
  ('code pays du site ignoré', A, [
    ("(typeof detail.countryId === 'number' ? PUBLISHER_COUNTRY_CODES[detail.countryId] : undefined) ??", "undefined ??")], [T]),
  ('configuration hors du site acceptée', A, [
    ("  if (typeof config.apiUrl !== 'string' || !API_URL.test(config.apiUrl)) throw new Error('MARC_O_POLO_INVALID_CONFIG: apiUrl');", "")], [T]),
  ('lieu du RAW retenu non lu (faits)', L, [
    ("      if (at(raw, '/source') === 'marc-o-polo-vacancies-v1') add(", "      if (false) add(")], [T]),
  ('cadence plancher de l’API supprimée', K, [
    ("  'host:vhfco59ro6.execute-api.eu-central-1.amazonaws.com': 7_000,\n", "")], [P]),
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

results = []
for label, path, edits, witnesses in CASES:
    full = os.path.join(WT, path)
    text = open(full, encoding='utf8').read()
    for old, new in edits:
        if text.count(old) != 1:
            print(f'REFUSED: pattern for « {label} » found {text.count(old)} times'); sys.exit(3)
        text = text.replace(old, new)
    open(full, 'w', encoding='utf8').write(text)
    try:
        out = run([VITEST, 'run', *witnesses], APP)
        files, tests, failed = summary(out.stdout + out.stderr)
        results.append((label, out.returncode, files, tests, sorted({f'{f} > {t[:100]}' for f, t in failed})))
    finally:
        open(full, 'w', encoding='utf8').write(run(['git', 'show', f'HEAD:{path}'], WT).stdout)
    if run(['git', 'status', '--porcelain'], WT).stdout.strip():
        print(f'ABORT: tree not clean after restoring {path}'); sys.exit(4)

head = run(['git', 'rev-parse', '--short', 'HEAD'], WT).stdout.strip()
print(f'# Témoins Marc O\'Polo sans leur garde, commit {head}')
for label, code, files, tests, failed in results:
    verdict = 'ÉCHOUE (témoin valide)' if code != 0 else 'PASSE — TÉMOIN INOPÉRANT'
    print(f'\n## {label}: {verdict}\n   files: {files} | tests: {tests}')
    for f in failed[:6]: print(f'   - {f}')

out = run([VITEST, 'run', T, P], APP)
files, tests, _ = summary(out.stdout + out.stderr)
print(f'\n## état committé restauré : exit {out.returncode} | files: {files} | tests: {tests}')
print('tree clean:', not run(['git', 'status', '--porcelain'], WT).stdout.strip())
