import os,json,pathlib,subprocess,urllib.parse,hashlib,sys
# usage: restore-clone-from-dump.py <dump-file> <proof-json>  — drops the current clone d and restores it from the given production dump (sha verified).
root=pathlib.Path('backups/lot4-20260909');dump=pathlib.Path(sys.argv[1]);proof=json.load(open(sys.argv[2]))
assert hashlib.file_digest(dump.open('rb'),'sha256').hexdigest()==proof['sha256'],'dump sha mismatch'
u=urllib.parse.urlsplit(json.load(open(root/'local-access-d.json'))['DATABASE_URL']);assert u.hostname=='127.0.0.1' and u.path=='/catwalks_lot4_replay_20260909d'
e=os.environ.copy();e.update(PGHOST=u.hostname,PGPORT=str(u.port),PGUSER=urllib.parse.unquote(u.username),PGPASSWORD=urllib.parse.unquote(u.password),PGSSLMODE='disable');b='/opt/homebrew/opt/libpq/bin/'
subprocess.run([b+'psql','-d','postgres','-v','ON_ERROR_STOP=1','-c',"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='catwalks_lot4_replay_20260909d' AND pid<>pg_backend_pid()"],env=e,check=True,capture_output=True)
subprocess.run([b+'psql','-d','postgres','-v','ON_ERROR_STOP=1','-c','DROP DATABASE IF EXISTS catwalks_lot4_replay_20260909d'],env=e,check=True)
subprocess.run([b+'createdb','catwalks_lot4_replay_20260909d'],env=e,check=True)
subprocess.run([b+'pg_restore','--no-owner','--no-privileges','--jobs=2','--exit-on-error','-d','catwalks_lot4_replay_20260909d',str(dump)],env=e,check=True)
print('clone d restored from',dump.name,'sha',proof['sha256'][:12])
