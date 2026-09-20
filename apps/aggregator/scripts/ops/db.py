"""Run a command against one of the project's databases, versioned in the repository.

The EXECUTABLE part — which database, read-only or not, how the URL is built — belongs in the repository so a
chain can be reviewed and replayed. The SECRETS do not: credentials stay in a host-local access file that is
never versioned, named by CATWALKS_DB_ACCESS (default: backups/remediation-20260908/local-access.json for the
local targets, backups/remediation-20260908/postgres-access.json for production).

Targets:
  production  the production database through its TCP proxy — writes allowed
  readonly    the same database, the same superuser role, with default_transaction_read_only and a statement
              timeout set through PGOPTIONS. This is a GUARDRAIL, NOT A GUARANTEE: it applies to libpq clients
              (psql) only, and the underlying role is a superuser no GRANT constrains. See the comment below.
  clone       the restored copy used for rehearsals (never production)
  test        the integration-test database (the suite refuses any name without "test")

usage: db.py <target> <command...>
"""
import json
import os
import pathlib
import subprocess
import sys
from urllib.parse import urlsplit, unquote, quote

ROOT = pathlib.Path(__file__).resolve().parents[4]
ACCESS_DIR = pathlib.Path(os.environ.get('CATWALKS_DB_ACCESS', ROOT / 'backups' / 'remediation-20260908'))
CLONE_ACCESS = pathlib.Path(os.environ.get('CATWALKS_CLONE_ACCESS', ROOT / 'backups' / 'lot4-20260909' / 'local-access-d.json'))

target = sys.argv[1] if len(sys.argv) > 1 else ''
if target not in {'production', 'readonly', 'clone', 'test'}:
    print(__doc__, file=sys.stderr)
    sys.exit(2)

if target == 'clone':
    url = json.loads(CLONE_ACCESS.read_text())['DATABASE_URL']
elif target == 'test':
    url = json.loads((ACCESS_DIR / 'local-access.json').read_text())['TEST_DATABASE_URL']
else:
    # Production is reached through the TCP proxy; the URL is rebuilt so credentials are escaped exactly once.
    d = json.loads((ACCESS_DIR / 'postgres-access.json').read_text())
    u = urlsplit(d['DATABASE_URL'])
    user, password = quote(unquote(u.username), safe=''), quote(unquote(u.password), safe='')
    url = f"postgresql://{user}:{password}@{d['RAILWAY_TCP_PROXY_DOMAIN']}:{d['RAILWAY_TCP_PROXY_PORT']}{u.path}?sslmode=require"

env = os.environ.copy()
env['DATABASE_URL'] = url
env['DIRECT_URL'] = url
if target == 'readonly':
    # ATTENTION — CETTE CIBLE NE GARANTIT PAS LA LECTURE SEULE (constat du 2026-09-20).
    #
    # Trois raisons, chacune vérifiée:
    #   1. PGOPTIONS est lu par libpq (psql), PAS par le moteur Rust de Prisma. Les 143 scripts
    #      d'audit qui passent par Prisma n'en recoivent rien: un CREATE TEMP TABLE a REUSSI.
    #   2. default_transaction_read_only est un REGLAGE PAR DEFAUT, pas un privilege: toute
    #      session peut le remettre a off.
    #   3. 'readonly' et 'production' lisent le MEME fichier d'identifiants, donc le meme role
    #      `postgres` — un SUPERUTILISATEUR, qu'aucun GRANT ne contraint.
    #
    # Cette cible reste utile comme garde-fou pour les clients libpq et pour le delai maximal,
    # mais un accès d'audit aux droits reellement limites a la lecture reste A CREER par une
    # intervention autorisee. Tant qu'il n'existe pas, aucune execution ici ne doit etre
    # presentee comme "incapable d'ecrire".
    env['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=25000'

sys.exit(subprocess.run(sys.argv[2:], env=env, cwd=ROOT).returncode)
