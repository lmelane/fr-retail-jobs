"""
LA SAUVEGARDE, ET SA PREUVE — un dump n'existe que si sa restauration a été démontrée (D26).

Ce programme fait la moitié qui se prouve seule : produire le dump, le hacher, et refuser d'écraser un
fichier existant. La seconde moitié — restaurer sur le clone et comparer les grandeurs — appartient à
`restore-clone-from-dump.py` puis à `production-counts.mts`, parce qu'une sauvegarde qu'on n'a pas rejouée
est une intention, pas une garantie.

Il remplace les scripts datés (`backup-0910.py`) : le chemin est un paramètre, pas une constante gravée dans
le nom du fichier — sinon chaque opération en crée un nouveau, et la chaîne maintenue se disperse.

usage: scripts/ops/db.py production python3 scripts/ops/backup.py <chemin.dump>
"""
import os, subprocess, urllib.parse, pathlib, hashlib, json, sys, time

# 0o077 : le dump contient l'intégralité de la base — il ne doit être lisible que par son propriétaire.
os.umask(0o077)

if len(sys.argv) < 2:
    sys.exit('usage: backup.py <chemin.dump>')
dump = pathlib.Path(sys.argv[1])
# Ne JAMAIS écraser : un dump effacé par un second passage emporte la seule copie d'un état antérieur.
if dump.exists():
    sys.exit(f'refus : {dump} existe déjà — choisir un autre chemin')
dump.parent.mkdir(parents=True, exist_ok=True)

u = urllib.parse.urlsplit(os.environ['DATABASE_URL'])
env = os.environ.copy()
env.update(
    PGHOST=u.hostname, PGPORT=str(u.port or 5432), PGDATABASE=u.path.lstrip('/'),
    PGUSER=urllib.parse.unquote(u.username or ''), PGPASSWORD=urllib.parse.unquote(u.password or ''),
    PGSSLMODE='require',
)

PG_DUMP = os.environ.get('PG_DUMP_BIN', '/opt/homebrew/opt/libpq/bin/pg_dump')
started = time.time()
subprocess.run([PG_DUMP, '-Fc', '--no-owner', '--no-privileges', '-f', str(dump)], env=env, check=True)
elapsed = round(time.time() - started, 1)

proof = {
    'dump': str(dump),
    'bytes': dump.stat().st_size,
    'sha256': hashlib.file_digest(dump.open('rb'), 'sha256').hexdigest(),
    'seconds': elapsed,
    'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    # La restauration reste À PROUVER : ce champ ne devient vrai que par un rejeu constaté.
    'restoreProven': False,
}
pathlib.Path(str(dump) + '.proof.json').write_text(json.dumps(proof, indent=1))
print(json.dumps(proof, indent=1))
