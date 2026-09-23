"""Build an engine-blind judgment pool from every top-20 result and variant.

Usage: pool.py snapshot_directory measurements.ndjson output.json
The grader sees native titles/employers/text, no rank, engine, or inferred code.
"""
import hashlib
import json
from pathlib import Path
import sys

snapshot, measurement, output = map(Path, sys.argv[1:])
assert not output.exists(), 'Do not overwrite existing judgments'
intentions = {i['id']: i for i in json.loads(Path(__file__).with_name('intentions.json').read_text())}
pools = {key: set() for key in intentions}
for line in measurement.open():
    r = json.loads(line)
    pools[r['intentionId']].update(r['ids'][:20])
anchor_file = Path(__file__).with_name('anchors.json')
if anchor_file.exists():
    for anchor in json.loads(anchor_file.read_text())['anchors']:
        pools[anchor['intentionId']].add(anchor['id'])
wanted = set().union(*pools.values())
documents, companies = {}, {}
for line in (snapshot / 'catalogue.ndjson').open():
    r = json.loads(line)
    if r['type'] == 'metadata':
        companies = {c['id']: c['name'] for c in r['companies']}
    elif r['type'] in ['job', 'direct']:
        j = r['job']; key = ('cw_' if r['type'] == 'direct' else '') + j['id']
        if key in wanted:
            documents[key] = {'id': key, 'title': j.get('rawTitle') or j['title'],
                'company': companies.get(j.get('companyId'), j.get('company')),
                'country': j['countryCode'], 'city': j.get('city'),
                'department': j.get('department'), 'description': j.get('description'),
                'sourceUrls': [s['url'] for s in j.get('sources', [])]}
assert wanted <= documents.keys()
records = []
for key, ids in pools.items():
    # Exact native title/company/country groups ease review; all underlying
    # descriptions remain available and can receive different grades.
    groups = {}
    for id in ids:
        d = documents[id]
        group = json.dumps([d['title'], d['company'], d['country']], ensure_ascii=False)
        groups.setdefault(group, []).append(d)
    ordered = sorted(groups.items(), key=lambda item: hashlib.sha256((key + item[0]).encode()).hexdigest())
    records.append({'intention': intentions[key], 'groups': [
        {'groupId': hashlib.sha256((key + group).encode()).hexdigest()[:12],
         'title': docs[0]['title'], 'company': docs[0]['company'], 'country': docs[0]['country'],
         'documents': sorted(docs, key=lambda d: d['id']), 'grade': None, 'reason': None}
        for group, docs in ordered]})
output.write_text(json.dumps(records, ensure_ascii=False, indent=2)); output.chmod(0o600)
print(json.dumps({'intentions':len(records),'pairs':sum(len(p) for p in pools.values()),
    'uniqueDocuments':len(documents),'groups':sum(len(r['groups']) for r in records)}))
