import os,subprocess,urllib.parse,pathlib,hashlib,json
os.umask(0o077)
u=urllib.parse.urlsplit(os.environ['DATABASE_URL']);p=pathlib.Path('backups/lot4-20260909/before-0910-qualification-production.dump');assert not p.exists()
e=os.environ.copy();e.update(PGHOST=u.hostname,PGPORT=str(u.port or 5432),PGDATABASE=u.path.lstrip('/'),PGUSER=urllib.parse.unquote(u.username),PGPASSWORD=urllib.parse.unquote(u.password),PGSSLMODE='require')
subprocess.run(['/opt/homebrew/opt/libpq/bin/pg_dump','-Fc','--no-owner','--no-privileges','-f',str(p)],env=e,check=True)
proof={'bytes':p.stat().st_size,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest()};pathlib.Path('backups/lot4-20260909/qualification-0910-backup-proof.json').write_text(json.dumps(proof,indent=2));print(proof)
