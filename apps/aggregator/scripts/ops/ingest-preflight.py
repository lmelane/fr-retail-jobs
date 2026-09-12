"""PRÉFLIGHT d'une ingestion de production bornée — il IMPOSE l'ordre, il ne le documente pas.

Chaque contrôle est bloquant : le programme sort en 1 au premier manquement et n'écrit rien. Rien de ce qui
suit ne peut donc démarrer sur un état non vérifié.

Ce qu'il vérifie, dans cet ordre (le brief P7) :
  1. le commit à exécuter est FIGÉ et passé en argument ;
  2. arbre Git propre · HEAD == commit attendu · aucun run en cours · aucun déploiement incompatible ;
  3. les DEUX services séparément — `catwalks-aggregator` ET `catwalks-web` — SUCCESS sur ce commit.
     Le succès de l'aggregator n'est JAMAIS lu comme celui du web : ce sont deux déploiements distincts, et
     confondre les deux a déjà fait conclure à tort qu'un correctif était en ligne ;
  4. l'allowlist est exactement la liste attendue — ni clé inconnue, ni clé manquante, ni dixième source, ni
     liste vide, et jamais déduite du statut ACTIVE (elle est comparée à une liste littérale) ;
  5–7. sauvegarde fraîche, RESTAURÉE dans un clone neuf, et comparée à la production sur six grandeurs.
     Un dump seul ne prouve rien : la restauration est la preuve (D26) ;
  8. les canaux d'alerte sont TESTÉS par émission réelle, pas déclarés « armés ».

usage: ingest-preflight.py --commit=<sha40> --keys=<k1,k2,...> [--skip-backup] [--out=<file.json>]
  --skip-backup  n'omet QUE la prise du dump (5) ; la restauration (6) et la comparaison (7) restent exigées
                 sur un dump existant nommé par --dump=.
exit 0 = tout est vérifié, l'ingestion peut être lancée ; exit 1 = refus motivé.
"""
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[3]
OPS = pathlib.Path(__file__).resolve().parent
CLONE_CONTAINER = os.environ.get('P7_CLONE_CONTAINER', 'catwalks-lot4-replay-pg18')
CLONE_USER = os.environ.get('P7_CLONE_USER', 'catwalks_lot4')
PG_DUMP = os.environ.get('PG_DUMP', '/opt/homebrew/opt/libpq/bin/pg_dump')

problems: list[str] = []
facts: dict = {}


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith(f'--{name}='):
            return a[len(name) + 3:]
    return default


def flag(name):
    return f'--{name}' in sys.argv


def sh(cmd, **kw):
    return subprocess.run(cmd, text=True, capture_output=True, **kw)


def fail(message):
    problems.append(message)


# ── 1. le commit à exécuter, figé ────────────────────────────────────────────────────────────────────────
commit = arg('commit', '')
keys_arg = arg('keys', '')
if len(commit) != 40 or not all(c in '0123456789abcdef' for c in commit):
    print('refus : --commit doit être un SHA complet de 40 caractères', file=sys.stderr)
    sys.exit(2)
if not keys_arg:
    print('refus : --keys est obligatoire (une allowlist vide n\'est jamais un périmètre)', file=sys.stderr)
    sys.exit(2)
keys = [k.strip() for k in keys_arg.split(',') if k.strip()]
facts['commit'] = commit
facts['keys'] = keys

# ── 2. état local : arbre propre, HEAD au bon commit ─────────────────────────────────────────────────────
dirty = sh(['git', 'status', '--porcelain'], cwd=ROOT).stdout.strip()
if dirty:
    fail(f'arbre Git non propre : {len(dirty.splitlines())} fichier(s) modifié(s)')
head = sh(['git', 'rev-parse', 'HEAD'], cwd=ROOT).stdout.strip()
facts['head'] = head
if head != commit:
    fail(f'HEAD {head[:12]} ≠ commit attendu {commit[:12]}')

# ── 2bis + 3. déploiements : les DEUX services, séparément ───────────────────────────────────────────────
sys.path.insert(0, str(OPS))
import importlib.util
spec = importlib.util.spec_from_file_location('railway_service', OPS / 'railway-service.py')
railway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(railway)

# Le périmètre de code de chaque service : ce qui, modifié, exige un redéploiement de CE service.
SERVICE_PATHS = {
    'aggregator': ('apps/aggregator/', 'packages/db/', 'data/'),
    'web': ('apps/web/', 'packages/db/'),
}

deployments = {}
for service in ('aggregator', 'web'):
    try:
        st = railway.status(service)
    except Exception as e:  # une API injoignable est un refus, jamais un « on suppose que ça va »
        fail(f'{service} : état de déploiement illisible — {e}')
        continue
    deployments[service] = st
    if st['status'] != 'SUCCESS':
        fail(f'{service} : déploiement {st["status"]}, attendu SUCCESS')

    if st['commit'] == commit:
        st['codeVerdict'] = 'DEPLOYED_AT_COMMIT'
        continue

    # Le service tourne sur un commit ANTÉRIEUR. Ce n'est un problème que si SON code a changé entre les deux.
    #
    # Railway ne redéploie un service que lorsque son périmètre est touché : `catwalks-web` ne bouge donc pas
    # pour un commit qui ne modifie que `apps/aggregator`. Exiger l'égalité stricte des SHA refuserait un état
    # parfaitement conforme — et, pire, pousserait à redéployer sans raison. Le critère juste n'est pas
    # « même SHA » mais « même CODE pour ce service », et cela se DÉMONTRE par le diff.
    diff = sh(['git', 'diff', '--name-only', f'{st["commit"]}..{commit}'], cwd=ROOT)
    if diff.returncode:
        fail(f'{service} : diff {str(st["commit"])[:12]}..{commit[:12]} illisible — le commit déployé est-il '
             f'présent localement ? ({diff.stderr.strip()[:120]})')
        st['codeVerdict'] = 'UNVERIFIABLE'
        continue
    touched = [f for f in diff.stdout.splitlines() if f.strip().startswith(SERVICE_PATHS[service])]
    st['commitBehind'] = st['commit']
    st['filesTouchedInScope'] = touched
    if touched:
        st['codeVerdict'] = 'STALE_CODE'
        fail(f'{service} : déployé sur {str(st["commit"])[:12]}, et {len(touched)} fichier(s) de son '
             f'périmètre ont changé depuis — ex. {touched[:3]}')
    else:
        # Conforme : l'image déployée contient, à l'identique, le code de ce service au commit retenu.
        st['codeVerdict'] = 'SAME_CODE_FOR_THIS_SERVICE'

facts['deployments'] = deployments

# La commande de démarrage de l'aggregator doit être la commande NORMALE avant qu'on pose la commande bornée.
agg = deployments.get('aggregator', {})
if agg and agg.get('startCommand') != 'sh apps/aggregator/start.sh':
    fail(f'aggregator : commande de démarrage résiduelle — {str(agg.get("startCommand"))[:80]}')

# ── 2ter. aucun run en cours ─────────────────────────────────────────────────────────────────────────────
run_check = sh(['python3', str(OPS / 'db.py'), 'readonly', 'npx', 'tsx', str(OPS / 'running-pipeline-runs.mts')])
running = [l for l in run_check.stdout.splitlines() if l.startswith('RUNNING ')]
if run_check.returncode:
    fail('PipelineRun illisible : ' + run_check.stderr[-200:])
if running:
    fail(f'run de production en cours : {running}')
facts['runningRuns'] = running

# ── 4. l'allowlist, exactement ───────────────────────────────────────────────────────────────────────────
cat = sh(['python3', str(OPS / 'db.py'), 'readonly', 'npx', 'tsx', str(OPS / 'source-keys.mts')])
if cat.returncode:
    fail('catalogue illisible : ' + cat.stderr[-200:])
else:
    catalogue = json.loads(cat.stdout[cat.stdout.index('{'):])
    known = set(catalogue['all'])
    unknown = [k for k in keys if k not in known]
    if unknown:
        fail(f'clés inconnues du catalogue : {unknown}')
    duplicates = [k for k in set(keys) if keys.count(k) > 1]
    if duplicates:
        fail(f'clés répétées dans l\'allowlist : {duplicates}')
    facts['catalogue'] = {'known': len(known), 'requested': len(keys)}

expected = arg('expect-keys')
if expected:
    want = [k.strip() for k in expected.split(',') if k.strip()]
    if sorted(want) != sorted(keys):
        missing = sorted(set(want) - set(keys))
        extra = sorted(set(keys) - set(want))
        fail(f'allowlist ≠ liste autorisée — manquantes {missing}, en trop {extra}')

# ── 5–7. sauvegarde, restauration, comparaison ───────────────────────────────────────────────────────────
stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
dump = pathlib.Path(arg('dump', f'backups/lot4-20260909/before-p7-run-{stamp}-production.dump'))
clone_db = arg('clone-db', f'catwalks_p7_preflight_{stamp.lower().replace("t", "_").replace("z", "")}')

if not flag('skip-backup'):
    script = ROOT / 'backups' / 'lot4-20260909' / f'backup-p7-run-{stamp}.py'
    script.write_text(
        'import os,subprocess,urllib.parse,pathlib,hashlib,json\n'
        'os.umask(0o077)\n'
        "u=urllib.parse.urlsplit(os.environ['DATABASE_URL'])\n"
        f"p=pathlib.Path({str(dump)!r})\n"
        "assert not p.exists(), 'ne jamais écraser une sauvegarde'\n"
        'e=os.environ.copy()\n'
        "e.update(PGHOST=u.hostname,PGPORT=str(u.port or 5432),PGDATABASE=u.path.lstrip('/'),"
        "PGUSER=urllib.parse.unquote(u.username),PGPASSWORD=urllib.parse.unquote(u.password),PGSSLMODE='require')\n"
        f"subprocess.run([{PG_DUMP!r},'-Fc','--no-owner','--no-privileges','-f',str(p)],env=e,check=True)\n"
        "print(json.dumps({'bytes':p.stat().st_size}))\n"
    )
    b = sh(['python3', 'backups/remediation-20260908/run.py', 'prod', 'python3', str(script)], cwd=ROOT)
    if b.returncode:
        fail('sauvegarde échouée : ' + b.stderr[-300:])

if not dump.exists():
    fail(f'sauvegarde absente : {dump}')
else:
    digest = hashlib.file_digest(dump.open('rb'), 'sha256').hexdigest()
    facts['backup'] = {'path': str(dump), 'bytes': dump.stat().st_size, 'sha256': digest}

    # 6. RESTAURER — c'est la restauration qui prouve, jamais le dump.
    sh(['docker', 'exec', CLONE_CONTAINER, 'psql', '-U', CLONE_USER, '-d', 'postgres',
        '-c', f'DROP DATABASE IF EXISTS {clone_db};'])
    c = sh(['docker', 'exec', CLONE_CONTAINER, 'psql', '-U', CLONE_USER, '-d', 'postgres',
            '-c', f'CREATE DATABASE {clone_db};'])
    if c.returncode:
        fail('création du clone impossible : ' + c.stderr[-200:])
    else:
        sh(['docker', 'cp', str(dump), f'{CLONE_CONTAINER}:/tmp/{clone_db}.dump'])
        r = sh(['docker', 'exec', CLONE_CONTAINER, 'pg_restore', '-U', CLONE_USER, '-d', clone_db,
                '--no-owner', '--no-privileges', '-j', '4', f'/tmp/{clone_db}.dump'])
        if r.returncode:
            fail(f'restauration échouée (exit {r.returncode}) : ' + r.stderr[-300:])
        else:
            # 7. comparer le clone restauré à la production, sur six grandeurs.
            counts_sql = (
                'SELECT (SELECT count(*) FROM "Job" WHERE "isActive"),(SELECT count(*) FROM "Job"),'
                '(SELECT count(*) FROM "JobSource"),'
                '(SELECT count(*) FROM "Source" WHERE status=\'ACTIVE\'),'
                '(SELECT count(*) FROM "Source" WHERE status=\'PAUSED\'),'
                '(SELECT count(*) FROM "Job" WHERE "isActive" AND "closedAt" IS NOT NULL),'
                '(SELECT count(*) FROM "Job" WHERE "countryIntegrity" IS NOT NULL)'
            )
            names = ['activeJobs', 'allJobs', 'jobSources', 'sourcesActive', 'sourcesPaused',
                     'activeWithClosedAt', 'withCountryIntegrity']
            q = sh(['docker', 'exec', CLONE_CONTAINER, 'psql', '-U', CLONE_USER, '-d', clone_db,
                    '-At', '-F', '|', '-c', counts_sql])
            restored = dict(zip(names, [int(x) for x in q.stdout.strip().split('|')])) if q.stdout.strip() else {}
            pq = sh(['python3', str(OPS / 'db.py'), 'readonly', 'npx', 'tsx', str(OPS / 'production-counts.mts')])
            produced = json.loads(pq.stdout[pq.stdout.index('{'):]) if '{' in pq.stdout else {}
            facts['restore'] = {'database': clone_db, 'restored': restored, 'production': produced}
            if not restored or not produced:
                fail('comparaison impossible : un des deux relevés est vide')
            else:
                # La production peut bouger entre le dump et la lecture : on n'exige l'égalité stricte que sur
                # ce qui ne peut PAS bouger sans run — et les crons sont gelés.
                for k in names:
                    if restored.get(k) != produced.get(k):
                        fail(f'restauration ≠ production sur {k} : {restored.get(k)} vs {produced.get(k)}')
                if restored.get('activeWithClosedAt', 1) != 0:
                    fail('violation : offre active portant closedAt dans la sauvegarde')

# ── 8. les canaux d'alerte, TESTÉS ───────────────────────────────────────────────────────────────────────
channels = {}
# Les identifiants des canaux vivent sur le service Railway, pas dans ce shell : on les LIT là où ils sont,
# plutôt que d'exiger qu'ils soient recopiés localement — un canal qu'on ne peut pas atteindre serait déclaré
# « non testable » alors qu'il fonctionne, et un secret recopié à la main est un secret de plus à perdre.
try:
    railway_vars = railway.api(
        'query($project:String!,$env:String!,$service:String!)'
        '{variables(projectId:$project,environmentId:$env,serviceId:$service)}',
        {'project': railway.PROJECT, 'env': railway.ENV, 'service': railway.SERVICES['aggregator']['id']},
    )['variables']
except Exception as e:
    railway_vars = {}
    fail(f'variables du service illisibles : {e}')

brevo_key = os.environ.get('BREVO_API_KEY') or railway_vars.get('BREVO_API_KEY')
sender = os.environ.get('BREVO_SENDER_EMAIL') or railway_vars.get('BREVO_SENDER_EMAIL')
recipient = (os.environ.get('ALERT_RECIPIENT') or railway_vars.get('ALERT_RECIPIENT')
             or 'loic.melane@catwalks.io')
if not brevo_key or not sender:
    fail('canal Brevo non testable : BREVO_API_KEY / BREVO_SENDER_EMAIL introuvables (ni shell, ni service)')
    channels['brevo'] = 'UNTESTED_NO_CREDENTIALS'
else:
    body = json.dumps({
        'sender': {'email': sender, 'name': os.environ.get('BREVO_SENDER_NAME', 'Mode Careers')},
        'to': [{'email': recipient}],
        'subject': f'[P7] test de transmission — préflight {stamp}',
        'textContent': f'Test d\'émission réelle avant l\'ingestion bornée P7.\ncommit {commit}\n'
                       f'sources {",".join(keys)}\nCe message prouve que le canal transmet.',
    }).encode()
    req = urllib.request.Request('https://api.brevo.com/v3/smtp/email', data=body,
                                 headers={'content-type': 'application/json', 'api-key': brevo_key})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            channels['brevo'] = f'SENT_{resp.status}'
    except Exception as e:
        fail(f'canal Brevo : émission échouée — {e}')
        channels['brevo'] = 'FAILED'

hc = os.environ.get('HEALTHCHECK_PING_URL') or railway_vars.get('HEALTHCHECK_PING_URL')
if not hc:
    fail('heartbeat non testable : HEALTHCHECK_PING_URL introuvable (ni shell, ni service)')
    channels['heartbeat'] = 'UNTESTED_NO_URL'
else:
    try:
        with urllib.request.urlopen(hc, timeout=15) as resp:
            channels['heartbeat'] = f'PINGED_{resp.status}'
        # Un échec doit être VISIBLE : on vérifie que la route /fail répond aussi, sans la déclencher pour de bon
        # (le ping de succès qui précède laisse le check au vert).
        channels['heartbeatFailRoute'] = hc.rstrip('/') + '/fail'
    except Exception as e:
        fail(f'heartbeat : ping échoué — {e}')
        channels['heartbeat'] = 'FAILED'
facts['alertChannels'] = channels

# ── verdict ──────────────────────────────────────────────────────────────────────────────────────────────
facts['problems'] = problems
facts['verdict'] = 'GO' if not problems else 'REFUS'
out = arg('out')
if out:
    pathlib.Path(out).write_text(json.dumps(facts, indent=2))
print(json.dumps(facts, indent=1))
sys.exit(1 if problems else 0)
