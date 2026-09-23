"""Create search projection tables in an EMPTY, explicitly local benchmark DB.

Usage: load-postgres.py snapshot_directory access_json psql_binary
Does not restore or modify any existing Catwalks database.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

snapshot, access_file, psql = map(Path, sys.argv[1:])
access = json.loads(access_file.read_text())
if access['PGHOST'] not in ['localhost', '127.0.0.1', '::1'] or not access['PGDATABASE'].startswith('catwalks_search_benchmark_'):
    raise SystemExit('Refusing anything except an explicitly local benchmark database')
manifest = json.loads((snapshot / 'manifest.json').read_text())
with (snapshot / 'catalogue.ndjson').open('rb') as f:
    assert hashlib.file_digest(f, 'sha256').hexdigest() == manifest['sha256']
env = os.environ.copy()
env.update({k: str(v) for k, v in access.items()})
env['PGOPTIONS'] = '-c statement_timeout=300000'

def sql(value):
    r = subprocess.run([str(psql), '-X', '-v', 'ON_ERROR_STOP=1', '-Atc', value],
                       env=env, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()

assert sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'") == '0', 'Refuse to overwrite any existing tables'
sql('CREATE TABLE search_snapshot(payload jsonb)')
with (snapshot / 'catalogue.ndjson').open('rb') as source:
    r = subprocess.run([str(psql), '-X', '-v', 'ON_ERROR_STOP=1', '-c',
        "COPY search_snapshot FROM STDIN WITH (FORMAT csv, DELIMITER E'\\x01', QUOTE E'\\x02')"],
        env=env, stdin=source, capture_output=True)
    assert r.returncode == 0, r.stderr.decode()
folder = Path(__file__).resolve().parent
root = folder.parents[3]
sql((folder / 'projection.sql').read_text())
for migration in ['20260916200000_recherche_normalisee', '20260916210000_recherche_vecteur']:
    sql((root / 'packages/db/prisma/migrations' / migration / 'migration.sql').read_text())
sql('CREATE TRIGGER catwalks_job_search_before_write BEFORE INSERT OR UPDATE ON "Job" FOR EACH ROW EXECUTE FUNCTION catwalks_refresh_job_search()')
sql((root / 'packages/db/prisma/migrations/20260916210200_recherche_vecteur_identites/migration.sql').read_text())
sql('UPDATE "Job" SET title=title')
sql('UPDATE "DirectOffer" SET "searchText"="searchText"')
sql('CREATE INDEX job_search_benchmark_gin ON "Job" USING gin ("searchVector")')
sql('CREATE INDEX direct_search_benchmark_gin ON "DirectOffer" USING gin ("searchVector")')
sql('ANALYZE')
assert int(sql('SELECT count(*) FROM "Job"')) == manifest['counts']['aggregate']
assert int(sql('SELECT count(*) FROM "DirectOffer"')) == manifest['counts']['direct']
print(json.dumps({'loaded': True, 'database': access['PGDATABASE'], 'sha256': manifest['sha256'],
                  'counts': manifest['counts']}))
