"""LES TÉMOINS DE L'AMORÇAGE PROUVÉ (D-483) ÉCHOUENT SANS LEUR GARDE (30/09/2026) — preuve rejouable.

    python3 audits/2026-09-30/scripts/d483-temoins-sans-garde.py            # unitaires seuls
    D483_TEST_DATABASE_URL=postgresql://…/…test… python3 …                  # + témoins en base (base jetable)

Pour chaque garde du lot, le programme la retire dans la copie de travail, lance ses témoins, puis RESTAURE LE FICHIER
DEPUIS SA COPIE EN MÉMOIRE et vérifie qu'il est identique octet pour octet. Il n'écrit rien d'autre, n'appelle ni
`git checkout`, ni `git stash`, ni `git show` ; il refuse de démarrer sur une copie modifiée (`git status`, lecture
seule). Aucun réseau. La base, facultative, doit porter « test » dans son nom (garde de `setup-integration.ts`).
Résultat du 30/09 : `audits/2026-09-30/d483-temoins-sans-garde.txt`."""
import hashlib, os, re, subprocess, sys

WT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
APP = WT + '/apps/aggregator'
VITEST = WT + '/node_modules/.bin/vitest'
S = 'apps/aggregator/src/'
UNIT = 'src/connectors/wafBootstrap.test.ts'
CAPTURE = 'src/lib/wafBootstrap.capture.test.ts'
BROWSER = 'src/lib/browser.bootstrap.test.ts'
PLAYWRIGHT = 'src/lib/wafBootstrap.playwright.test.ts'
DB = 'src/pipeline/sourceAccessWafBootstrap.test.ts'

CASES = [
  ('filtre de qualification ouvert (le navigateur charge toute la page)', S + 'connectors/wafBootstrap.ts',
   "  return request => isTarget(request, challenged) || isChallengeHost(originOf(request.url) ?? '');",
   "  return () => true;", [UNIT, CAPTURE]),
  ('liste nommée ouverte à toute source et origine', S + 'connectors/wafBootstrap.ts',
   "  return Object.hasOwn(WAF_BOOTSTRAP_SOURCES, sourceKey) && WAF_BOOTSTRAP_SOURCES[sourceKey].includes(origin);",
   "  return true;", [UNIT, CAPTURE]),
  ('dérivation qui accepte une requête hors de l’infrastructure du défi', S + 'connectors/wafBootstrap.ts',
   "  if (targets.size !== 1) throw",
   "  if (!targets.size) throw", [UNIT]),
  ('dérivation sans contrôle d’identité', S + 'connectors/wafBootstrap.ts',
   "    if (request.userAgent !== BROWSER_USER_AGENT) throw new Error('ACCESS_BOOTSTRAP: requête d\\'amorçage sans l\\'identité du collecteur');",
   "", [UNIT]),
  ('filtre sous décision qui ignore les hôtes déclarés', S + 'connectors/wafBootstrap.ts',
   "  return request => isTarget(request, challenged) || hosts.has(originOf(request.url) ?? '');",
   "  return request => isTarget(request, challenged) || isChallengeHost(originOf(request.url) ?? '');", [UNIT, CAPTURE]),
  ('collecte du RUN qui amorce sans que la décision le déclare', S + 'capture/batch.ts',
   "    if (!grant) throw new SourceAccessGateError('ACCESS_SCOPE', 'WAF bootstrap is outside the reviewed access decision');\n    return { allow: grantedAllow(url, grant) };",
   "    if (!grant) return { allow: observeModeAllow(url) };\n    return { allow: grantedAllow(url, grant) };", [CAPTURE]),
  ('autre fournisseur amorcé dans une collecte', S + 'lib/wafToken.ts',
   "  if (vendor !== 'aws') return Promise.resolve(undefined);\n", "", [CAPTURE]),
  ('jeton du process réutilisé par une collecte', S + 'lib/wafToken.ts',
   "    return run?.origin === originOf(url) ? run.value : undefined;",
   "    return run?.origin === originOf(url) ? run.value : cookies.get(originOf(url));", [CAPTURE]),
  ('jeton rendu par l’infrastructure du défi archivé', S + 'lib/wafToken.ts',
   "  if (isChallengeHost(target.origin) && observation.resourceType !== 'script' && observation.body !== null) {",
   "  if (false) {", [CAPTURE]),
  ('rejeu qui lève le défi sans amorçage inscrit', S + 'capture/offlineReplay.ts',
   "    if (consumed || !bootstrap.rows.length) return false;", "    if (consumed) return false;", [CAPTURE]),
  ('requête navigateur étrangère comptée comme amorçage', S + 'capture/context.ts',
   "      if (request.wafBootstrap !== undefined && request.wafBootstrap === context.wafBootstrapRun && record.format === 'BROWSER_RESPONSE' &&",
   "      if (context.wafBootstrapRun && record.format === 'BROWSER_RESPONSE' &&", [CAPTURE]),
  ('requête partie sans réponse jamais inscrite', S + 'lib/browser.ts',
   "      for (const request of sent) {", "      for (const request of []) {", [BROWSER]),
  ('amorçage observé compté comme transport non supporté (politique fermée comme avant)', S + 'lib/browser.ts',
   "    const browser = await getBrowser(!observer);", "    const browser = await getBrowser();", [BROWSER]),
  ('inscription dans le contexte du lancement du navigateur (audit : CRITICAL)', S + 'lib/wafToken.ts',
   "  const record = (observation: BootstrapObservation) => withCaptureContext(context, () => recordBootstrapRequest(observation, run));",
   "  const record = (observation: BootstrapObservation) => recordBootstrapRequest(observation, run);", [PLAYWRIGHT]),
  ('marque d’amorçage d’une autre collecte acceptée', S + 'capture/context.ts',
   "      if (request.wafBootstrap !== undefined && request.wafBootstrap === context.wafBootstrapRun && record.format === 'BROWSER_RESPONSE' &&",
   "      if (request.wafBootstrap !== undefined && context.wafBootstrapRun && record.format === 'BROWSER_RESPONSE' &&", [CAPTURE]),
  ('pseudo-en-têtes HTTP/2 conservés (second tour : MEDIUM)', S + 'lib/browser.ts',
   "    .then(headers => Object.fromEntries(Object.entries(headers).filter(([name]) => !name.startsWith(':'))))\n", "", [PLAYWRIGHT]),
  ('redirection après le début de la vidange non détectée (second tour : MEDIUM)', S + 'lib/browser.ts',
   "    if (draining) late ??= new Error('WAF bootstrap redirect sent after the journal was drained');\n    else sent.add(request);",
   "    sent.add(request);", [PLAYWRIGHT]),
  ('redirection avant la vidange, hors bornes, non détectée (audit : HIGH)', S + 'lib/browser.ts',
   "    if (escaped(request)) failure ??= new Error('WAF bootstrap request escaped its authorization (redirect)');\n", "", [PLAYWRIGHT]),
  ('WebSocket non retenu (audit : HIGH)', S + 'lib/browser.ts',
   "    if (allow) await context.routeWebSocket(/.*/, socket => socket.close());\n", "", [PLAYWRIGHT]),
  ('requêtes encore envoyées pendant la vidange (audit : MEDIUM)', S + 'lib/browser.ts',
   "      closing = true;\n", "", [PLAYWRIGHT]),
  ('origine dérivée de la première ligne inscrite (audit : MEDIUM)', S + 'connectors/wafBootstrap.ts',
   "  const [origin] = targets;\n", "  const origin = ordered[0].url.origin;\n", [UNIT]),
  ('fin de collecte sans relecture du journal d’amorçage (unitaire)', S + 'connectors/wafBootstrap.ts',
   "  if (!grant || !bootstrapAuthorizedFor(sourceKey, grant.origin) || requests.some(request => !bootstrapRequestCovered(grant, challenged, request)))",
   "  if (false)", [UNIT]),
  ('document forgé qui déclare un amorçage pour une autre source', S + 'connectors/wafBootstrap.ts',
   "    if (sourceKey !== undefined && !bootstrapAuthorizedFor(sourceKey, item.origin)) return invalidAccess('This source is not authorized to bootstrap a WAF challenge (D-483)');",
   "", [UNIT]),
]
DB_CASES = [
  ('fin de collecte sans relecture du journal d’amorçage (en base)', S + 'capture/batch.ts',
   "      if (context.wafBootstrapped) {\n        try { assertJournaledBootstrap(",
   "      if (false) {\n        try { assertJournaledBootstrap(", [DB]),
  ('inspection qui ne vérifie pas les hôtes de l’amorçage', S + 'connectors/sourceAccessEvidence.ts',
   "          !bootstrapRequestCovered(bootstrap, challenged, { sequence: row.sequence, url, method: hop.request.method, userAgent: hop.request.userAgent }))",
   "          false)", [DB]),
  ('décision relue sans contrôle du compte d’amorçage', S + 'connectors/sourceAccess.ts',
   "    (document.bootstraps?.length ? !Number.isSafeInteger(report.bootstrapRequestCount) || report.bootstrapRequestCount! < 1 || report.bootstrapRequestCount! > 100_000\n      : report.bootstrapRequestCount !== undefined)) return",
   "    false) return", [DB]),
]

def run(cmd, cwd, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=env)

def summary(out):
    files = re.findall(r'Test Files\s+(.*)', out)
    tests = re.findall(r'Tests\s+(.*)', out)
    failed = re.findall(r'(?:×|FAIL)\s+(\S+\.test\.ts)\s*>\s*(.*)', out)
    return (files[-1].strip() if files else '?'), (tests[-1].strip() if tests else '?'), failed

if run(['git', 'status', '--porcelain'], WT).stdout.strip():
    print('REFUSED: working tree not clean before proofs'); sys.exit(2)
database = os.environ.get('D483_TEST_DATABASE_URL')
if database and not re.search(r'test', database.rsplit('/', 1)[-1], re.I):
    print('REFUSED: the database name must contain "test"'); sys.exit(2)
env = dict(os.environ, **({'DATABASE_URL': database} if database else {}))
cases = CASES + (DB_CASES if database else [])

results = []
for label, path, old, new, witnesses in cases:
    full = os.path.join(WT, path)
    original = open(full, 'rb').read()
    digest = hashlib.sha256(original).hexdigest()
    text = original.decode('utf8')
    if text.count(old) != 1:
        print(f'REFUSED: pattern for « {label} » found {text.count(old)} times in {path}'); sys.exit(3)
    open(full, 'w', encoding='utf8').write(text.replace(old, new))
    try:
        out = run([VITEST, 'run', *witnesses], APP, env)
        files, tests, failed = summary(out.stdout + out.stderr)
        results.append((label, path, out.returncode, files, tests, sorted({f'{f} > {t[:110]}' for f, t in failed})))
    finally:
        open(full, 'wb').write(original)
    if hashlib.sha256(open(full, 'rb').read()).hexdigest() != digest:
        print(f'ABORT: {path} differs from its in-memory copy after restoring'); sys.exit(4)

print(f'{len(results)} gardes retirées une à une, chaque fichier restauré depuis la mémoire (empreinte vérifiée)'
      + ('' if database else ' — témoins en base NON exécutés (D483_TEST_DATABASE_URL absent)'))
for label, path, code, files, tests, failed in results:
    verdict = 'ÉCHOUE (témoin valide)' if code != 0 else 'PASSE — TÉMOIN INOPÉRANT'
    print(f'\n## {label} [{path}]: {verdict}\n   files: {files} | tests: {tests}')
    for f in failed[:6]: print(f'   - {f}')

witnesses = sorted({w for *_, ws in cases for w in ws})
out = run([VITEST, 'run', *witnesses], APP, env)
files, tests, _ = summary(out.stdout + out.stderr)
print(f'\nContre-épreuve sur l’état committé : files: {files} | tests: {tests} (code {out.returncode})')
clean = not run(['git', 'status', '--porcelain'], WT).stdout.strip()
print('Copie de travail propre après la preuve.' if clean else 'ATTENTION : copie de travail modifiée après la preuve.')
sys.exit(0 if all(code != 0 for _, _, code, *_ in results) and out.returncode == 0 and clean else 1)
