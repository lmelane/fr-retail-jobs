"""Freeze public search data through the existing Railway SSH access.

No credential or raw catalogue content is printed. Output is private and must
remain outside Git. Usage: python3 -B snapshot.py /absolute/output/directory
"""
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

output = Path(sys.argv[1]).resolve()
output.mkdir(parents=True, exist_ok=False, mode=0o700)
script = Path(__file__).with_name('export-snapshot.cjs').read_bytes()
command = ['railway', 'ssh', '--project', '0eae47d0-598d-4cf0-bb3f-b38921eafa7e',
           '--environment', 'e66b019c-d280-41dc-85d8-25ed86bdd101',
           '--service', '9c50b8a9-5651-478f-b0d1-5bc02d2c138f', '--',
           'node', '-e', shlex.quote(script.decode())]
result = subprocess.run(command, capture_output=True, timeout=420)
if result.returncode:
    (output / 'error.private.log').write_bytes(result.stderr)
    os.chmod(output / 'error.private.log', 0o600)
    raise SystemExit('Snapshot failed; private error log retained; no DB write performed.')
archive = base64.b64decode(result.stdout.strip(), validate=True)
raw = gzip.decompress(archive)
rows = [json.loads(line) for line in raw.splitlines()]
assert rows[0]['type'] == 'metadata' and rows[-1]['type'] == 'complete'
counts = rows[-1]
assert counts['aggregate'] == counts['databaseAggregateCount']
assert counts['aggregate'] == sum(row['type'] == 'job' for row in rows)
assert counts['direct'] == sum(row['type'] == 'direct' for row in rows)
ids = [row['job']['id'] for row in rows if row['type'] == 'job']
assert len(set(ids)) == len(ids)
for name, content in [('catalogue.ndjson.gz', archive), ('catalogue.ndjson', raw)]:
    (output / name).write_bytes(content)
    os.chmod(output / name, 0o600)
manifest = {'asOf': rows[0]['asOf'], 'schemaVersion': 1,
            'transaction': rows[0]['transaction'], 'counts': counts,
            'sha256': hashlib.sha256(raw).hexdigest(),
            'archiveSha256': hashlib.sha256(archive).hexdigest(),
            'exporterSha256': hashlib.sha256(script).hexdigest(),
            'bytes': len(raw), 'compressedBytes': len(archive),
            'occupationRelease': rows[0]['occupationRelease']['id']}
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
os.chmod(output / 'manifest.json', 0o600)
print(json.dumps(manifest), flush=True)
