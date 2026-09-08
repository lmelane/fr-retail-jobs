import os,sys,json,subprocess
from urllib.parse import urlsplit,unquote
from pathlib import Path
# Audit only: PostgreSQL default read-only AND a read-only repeatable snapshot.
v=json.loads(Path('/tmp/catwalks-reaudit-pg-vars.json').read_text())
u=urlsplit(v['DATABASE_URL'])
e=os.environ.copy();e.update(PGHOST=v['RAILWAY_TCP_PROXY_DOMAIN'],PGPORT=v['RAILWAY_TCP_PROXY_PORT'],PGDATABASE=u.path.lstrip('/'),PGUSER=unquote(u.username),PGPASSWORD=unquote(u.password),PGSSLMODE='require',PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=25000 -c application_name=catwalks_readonly_reaudit',PAGER='cat')
sql=Path(sys.argv[1]).read_text()
assert sql.strip().startswith('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;')
r=subprocess.run(['/opt/homebrew/opt/libpq/bin/psql','-X','-qAt','-v','ON_ERROR_STOP=1'],input=sql,text=True,env=e,capture_output=True)
if r.returncode: print(r.stderr,file=sys.stderr);sys.exit(r.returncode)
for line in r.stdout.splitlines():
 if not line.strip():continue
 x=json.loads(line);Path(sys.argv[2],x['dataset']+'.json').write_text(json.dumps(x['rows'],ensure_ascii=False,indent=2)+'\n')
 print(x['dataset'],len(x['rows']))
