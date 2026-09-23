"""Run local TypeScript benchmark commands without exposing DB credentials.

Usage: run.py access.json script.ts [arguments...]
"""
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import quote

access = json.loads(Path(sys.argv[1]).read_text())
if access['PGHOST'] not in ['localhost', '127.0.0.1', '::1'] or not access['PGDATABASE'].startswith('catwalks_search_benchmark_'):
    raise SystemExit('Refusing anything except an explicitly local benchmark database')
env = os.environ.copy()
env['DATABASE_URL'] = 'postgresql://{}:{}@{}:{}/{}?connection_limit=2'.format(
    quote(access['PGUSER'], safe=''), quote(access['PGPASSWORD'], safe=''),
    access['PGHOST'], access['PGPORT'], access['PGDATABASE'])
folder = Path(__file__).resolve().parents[2]  # apps/api: real baseline CSV path
# measure.ts takes three file paths before its optional engine list. Resolve
# them in the caller's directory before setting the baseline's working dir.
arguments = [str(Path(arg).resolve()) if i < 3 else arg for i, arg in enumerate(sys.argv[3:])]
sys.exit(subprocess.run(['npx', 'tsx', str(Path(sys.argv[2]).resolve()), *arguments], cwd=folder, env=env).returncode)
