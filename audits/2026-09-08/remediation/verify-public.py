"""Read a bounded set of real production pages/API responses; no generated data."""
import datetime
import hashlib
import json
import pathlib
import re
import urllib.error
import urllib.parse
import urllib.request

root = pathlib.Path(__file__).parent
db = json.loads((root / 'production-readout.json').read_text())
base = 'https://modecareers.com'
rows = []

def read(path):
    request = urllib.request.Request(base + path, headers={'User-Agent': 'Catwalks-production-audit/1.0'})
    try:
        response = urllib.request.urlopen(request, timeout=40)
    except urllib.error.HTTPError as error:
        response = error
    body = response.read()
    metadata = {'url': base + path, 'finalUrl': response.url, 'status': response.status,
                'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'sha256': hashlib.sha256(body).hexdigest()}
    return metadata, body

def api(params, expected):
    row, body = read('/api/jobs?' + urllib.parse.urlencode(params))
    result = json.loads(body)
    row.update(total=result.get('total'), expectedFromDatabase=expected,
               delta=result.get('total', -1) - expected,
               totalInDatabase=result.get('totalInDatabase'), returnedRows=len(result.get('jobs', [])))
    row['countriesFacet'] = result.get('facets', {}).get('countries', [])
    row['sampleEmployers'] = sorted({job['company'] for job in result.get('jobs', [])})
    rows.append(row)

api({'pays': 'monde'}, db['activeJobs'])
counts = {row['countryCode']: row['_count'] for row in db['countries']}
for code in ['FR', 'US', 'GB', 'DE', 'IT', 'CA', 'ES', 'AU']:
    api({'pays': code}, db['franceFilter'] if code == 'FR' else counts.get(code, 0))
for source, cohort in db['cohorts'].items():
    api({'source': source}, sum(cohort['counts'].values()))
for name in ['Maje', 'Claudie Pierlot', 'Fursac', 'Sandro', 'SMCP']:
    # This is a global Maison count, which may include other feeds.
    row, body = read('/api/jobs?' + urllib.parse.urlencode({'maison': name}))
    result = json.loads(body)
    row.update(total=result.get('total'), sampleEmployers=sorted({j['company'] for j in result.get('jobs', [])}))
    rows.append(row)
for path in ['/api/health', '/', '/maisons', '/intelligence/pays/FR']:
    row, body = read(path)
    if path == '/api/health': row['health'] = json.loads(body)
    rows.append(row)
for job in db['oracleExamples']:
    row, body = read('/offre/' + urllib.parse.quote(job['id']))
    documents = re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', body.decode(), re.S)
    row['jobPosting'] = [{k: parsed[k] for k in ['@type', 'title', 'hiringOrganization', 'jobLocation', 'datePosted', 'url'] if k in parsed}
                         for document in documents if 'JobPosting' in document
                         for parsed in [json.loads(document)]]
    row['expectedCountry'] = job['countryCode']
    rows.append(row)

report = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'readOnly': True,
          'requests': len(rows), 'rows': rows,
          'countMismatches': [row for row in rows if row.get('delta', 0) != 0],
          'httpFailures': [row for row in rows if row['status'] != 200]}
(root / 'production-public-proof.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'requests': len(rows), 'countMismatches': len(report['countMismatches']),
                  'httpFailures': len(report['httpFailures']),
                  'totals': [{k: row[k] for k in ['url', 'total', 'expectedFromDatabase', 'delta'] if k in row} for row in rows if 'total' in row]}, ensure_ascii=False))
if report['countMismatches'] or report['httpFailures']:
    raise SystemExit(1)
