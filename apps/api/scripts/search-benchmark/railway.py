"""Bounded, read-only measurement of the actual production API and Railway DB.

Uses existing Railway CLI credentials; never prints credentials or response bodies.
Does not start ingestion: run once at rest and again during an authorized worker run.
Usage: railway.py OUTPUT.json --sha FULL_SHA --phase baseline|ingestion [--requests 240] [--concurrency 4]
"""
import argparse
import concurrent.futures
import datetime as dt
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / 'apps/aggregator/scripts/ops'))
from railway_api import api  # noqa: E402

ENVIRONMENT = 'e66b019c-d280-41dc-85d8-25ed86bdd101'
API_SERVICE = '9c50b8a9-5651-478f-b0d1-5bc02d2c138f'
DB_SERVICE = 'b5c68d1c-6988-4f15-8d85-afe684109cea'
BASE = 'https://agregator.catwalks.io'
WORKLOAD = [
    {'marche': 'FR', 'q': ''}, {'marche': 'US', 'q': ''},
    {'marche': 'FR', 'q': 'sales advisor'}, {'marche': 'FR', 'q': 'conseiller de vente'},
    {'marche': 'FR', 'q': 'conseiller de ventte'}, {'marche': 'US', 'q': 'store manager'},
    {'marche': 'FR', 'q': 'sales advisor Chanel'}, {'marche': 'US', 'q': 'sales advisor Chanel'},
    {'marche': 'CA', 'q': 'sales advisor'}, {'marche': 'CH', 'q': 'store manager'},
    {'marche': 'BE', 'q': 'sales advisor'}, {'marche': 'DE', 'q': 'Verkäufer'},
    {'marche': 'FR', 'q': 'modéliste'}, {'marche': 'FR', 'q': 'sales advisor', 'lieu': 'Paris'},
    {'marche': 'FR', 'q': 'sales advisor', 'contrat': 'PERMANENT'},
    {'marche': 'US', 'q': 'designer'},
]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--phase', choices=['baseline', 'ingestion'], required=True)
    parser.add_argument('--requests', type=int, default=240)
    parser.add_argument('--concurrency', type=int, default=4)
    args = parser.parse_args()
    if args.output.exists() or not 32 <= args.requests <= 480 or not 1 <= args.concurrency <= 8:
        parser.error('Create-only output; 32..480 requests and 1..8 concurrent requests required')
    variables = json.loads(subprocess.check_output([
        'railway', 'variable', 'list', '--service', API_SERVICE, '--environment', ENVIRONMENT, '--json'], text=True))
    key = variables['CATALOGUE_API_KEY']
    assert key and not key.startswith('${{'), 'Unresolved API credential'
    run_id = 'search-qualification-' + uuid.uuid4().hex[:12]

    def get(path, authenticate=True):
        started = time.monotonic()
        headers = {'x-request-id': run_id + '-' + uuid.uuid4().hex[:8]}
        if authenticate:
            headers['Authorization'] = 'Bearer ' + key
        request = urllib.request.Request(BASE + path, headers=headers)
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
                status, body = response.status, json.load(response)
        except urllib.error.HTTPError as error:
            status, body = error.code, {}
        except (OSError, ValueError):
            status, body = 0, {}
        return status, body, (time.monotonic() - started) * 1000

    def jobs(params):
        status, body, elapsed = get('/api/jobs?' + urllib.parse.urlencode(params))
        rows = body.get('jobs', [])
        expected = {'GB': ['GB', 'IE'], 'DE': ['DE', 'AT']}.get(params['marche'], [params['marche']])
        now = dt.datetime.now(dt.timezone.utc)
        expired = [j['id'] for j in rows if j.get('validThrough') and dt.datetime.fromisoformat(j['validThrough'].replace('Z', '+00:00')) <= now]
        record = {'params': params, 'status': status, 'ms': round(elapsed, 2), 'total': body.get('total'),
                  'ids': [j['id'] for j in rows], 'uncoded': sum(not j.get('occupationCode') for j in rows),
                  'outsideMarket': sum(j.get('countryCode') not in expected for j in rows),
                  'expired': expired, 'withdrawn': [j['id'] for j in rows if j.get('withdrawnAt')],
                  'facetsPresent': bool(body.get('facettes'))}
        return record, body

    status, before, _ = get('/api/health', False)
    assert status == 200 and before['runtime']['gitSha'] == args.sha and before['search']['ready'], 'Runtime not ready or wrong SHA'
    auth, _, _ = get('/api/jobs?marche=FR', False)
    assert auth == 401, 'Authentication contract failed'
    started = dt.datetime.now(dt.timezone.utc)
    smoke, bodies = [], []
    for params in WORKLOAD:
        record, body = jobs(params); smoke.append(record); bodies.append(body)
    checks = {'authentication': True,
              'synonyms': smoke[2]['ids'] == smoke[3]['ids'] and smoke[2]['total'] == smoke[3]['total'] and bool(smoke[2]['ids']),
              'typo': smoke[3]['ids'] == smoke[4]['ids'] and smoke[3]['total'] == smoke[4]['total']}
    for market, locales in [('CA', ['en-CA', 'fr-CA']), ('CH', ['fr-CH', 'de-CH', 'it-CH']), ('BE', ['fr-BE', 'nl-BE', 'de-BE', 'en-BE'])]:
        records = [jobs({'marche': market, 'q': 'sales advisor', 'locale': locale})[0] for locale in locales]
        smoke.extend(records)
        checks['locales_' + market] = all(r['status'] == 200 and r['ids'] == records[0]['ids'] and r['total'] == records[0]['total'] for r in records) and bool(records[0]['ids'])
    cursor = bodies[2].get('suivant')
    if cursor:
        record, _ = jobs({**WORKLOAD[2], 'apres': cursor}); smoke.append(record)
        checks['pagination'] = record['status'] == 200 and bool(record['ids']) and not set(record['ids']) & set(smoke[2]['ids'])
    else:
        checks['pagination'] = False
    checks['composed'] = bool(smoke[6]['ids']) and bool(smoke[7]['ids'])
    checks['uncoded'] = any(r['uncoded'] > 0 for r in smoke)
    rows = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        # Bound the batch. Two consecutive failed responses stop the load early.
        for offset in range(0, args.requests, args.concurrency):
            batch = list(pool.map(lambda i: jobs(WORKLOAD[i % len(WORKLOAD)])[0], range(offset, min(args.requests, offset + args.concurrency))))
            rows.extend(batch)
            if sum(r['status'] != 200 for r in batch) >= 2:
                break
    ended = dt.datetime.now(dt.timezone.utc)
    status, after, _ = get('/api/health', False)
    checks['health'] = status == 200 and after.get('runtime', {}).get('gitSha') == args.sha and after.get('search', {}).get('ready') is True
    checks['requests'] = len(rows) == args.requests and all(r['status'] == 200 and not r['outsideMarket'] and not r['expired'] and not r['withdrawn'] and r['facetsPresent'] for r in rows + smoke)
    metrics = api('''query($environment:String!,$service:String!,$start:DateTime!,$end:DateTime!){
      metrics(environmentId:$environment,serviceId:$service,startDate:$start,endDate:$end,
        measurements:[CPU_USAGE,CPU_USAGE_2,CPU_LIMIT,MEMORY_USAGE_GB,MEMORY_LIMIT_GB],sampleRateSeconds:30){measurement values{ts value}}}''',
      {'environment': ENVIRONMENT, 'service': DB_SERVICE, 'start': started.isoformat(), 'end': ended.isoformat()})
    times = sorted(r['ms'] for r in rows)
    report = {'runId': run_id, 'phase': args.phase, 'sha': args.sha, 'startedAt': started.isoformat(), 'endedAt': ended.isoformat(),
              'concurrency': args.concurrency, 'requests': len(rows), 'p50Ms': statistics.median(times), 'p95Ms': times[math.ceil(.95 * len(times))-1],
              'healthBefore': before, 'healthAfter': after, 'checks': checks, 'pass': all(checks.values()),
              'smoke': smoke, 'measurements': rows, 'databaseMetrics': metrics['metrics'],
              'limits': ['HTTP times include the public network and JSON transfer.', 'Ingestion overlap must be proved separately with PipelineRun timestamps.',
                         'Railway metrics can arrive late; collect the same time window again before final interpretation.',
                         'No native offer is mutated by this measurement. Closure/expiration transitions require separate lifecycle evidence.']}
    with args.output.open('x') as stream:
        args.output.chmod(0o600); json.dump(report, stream, indent=2)
    print(json.dumps({k: report[k] for k in ['runId', 'phase', 'requests', 'p50Ms', 'p95Ms', 'checks', 'pass']}))
    return 0 if report['pass'] else 1


if __name__ == '__main__':
    sys.exit(main())
