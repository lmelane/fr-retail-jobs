"""Check native inclusion/exclusion regressions for candidate top-100 results.
Usage: verify.py measurements.ndjson summary.json
No database, no model-generated judgments, no silent missing case.
"""
import hashlib
import json
from pathlib import Path
import sys

measurements = [json.loads(line) for line in Path(sys.argv[1]).open()]
summary = json.loads(Path(sys.argv[2]).read_text())
with Path(sys.argv[1]).open('rb') as stream:
    if hashlib.file_digest(stream, 'sha256').hexdigest() != summary['measurementSha256']:
        raise SystemExit('Measurements do not match this summary')
regressions = json.loads(Path(__file__).with_name('regressions.json').read_text())
if summary['snapshotSha256'] != regressions['snapshotSha256']:
    raise SystemExit('Snapshot mismatch')
checks, failures = 0, []
for engine in ['postgres', 'elastic']:
    values = summary['engines'].get(engine)
    if not values: raise SystemExit(f'Missing {engine}')
    for key in ['outsideIndexedMarket', 'zeroDespiteKnownPositive']:
        checks += 1
        if values[key] != 0: failures.append({'engine': engine, 'metric': key, 'value': values[key]})
    for case in regressions['cases']:
        rows = [r for r in measurements if r['engine'] == engine and r['intentionId'] == case['intentionId']]
        if not rows: raise SystemExit('Missing regression intention')
        for r in rows:
            checks += 1
            found = bool(set(case['ids']) & set(r['ids']))
            if found != case['present']:
                failures.append({'engine': engine, 'q': r['q'], 'expectedPresent': case['present'], 'basis': case['basis']})
print(json.dumps({'checks': checks, 'failures': failures, 'passed': not failures}, ensure_ascii=False, indent=2))
sys.exit(bool(failures))
