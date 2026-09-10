"""READ-ONLY: report the cron schedule, start command and pause variables of the three production workers.
No mutation — the freeze itself is done by freeze-crons.py. usage: read-crons.py [--json]"""
import json, subprocess, datetime, sys
api = ['python3', 'backups/observability-20260909/railway-api.py']
env = 'e66b019c-d280-41dc-85d8-25ed86bdd101'
project = '0eae47d0-598d-4cf0-bb3f-b38921eafa7e'
services = {'aggregator': '203613c5-701f-4013-a2c0-66c8de147c34', 'refresh': 'ddc5dece-7865-4cfa-b71e-8d139e2e1ea5', 'reconcile': '85d0e5ba-992a-467e-9ddd-0dc25be1d74c'}
FROZEN = '0 0 29 2 *'


def call(q, v):
    r = subprocess.run(api, input=json.dumps({'query': q, 'variables': v}), text=True, capture_output=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-400:] + r.stdout[-400:])
    return json.loads(r.stdout)


out = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'), 'frozenSentinel': FROZEN, 'services': {}, 'problems': []}
for name, sid in services.items():
    si = call('query($env:String!,$service:String!){serviceInstance(environmentId:$env,serviceId:$service){cronSchedule startCommand latestDeployment{status createdAt}}}', {'env': env, 'service': sid})['serviceInstance']
    vs = call('query($project:String!,$env:String!,$service:String!){variables(projectId:$project,environmentId:$env,serviceId:$service)}', {'project': project, 'env': env, 'service': sid})['variables']
    row = {'cronSchedule': si['cronSchedule'], 'startCommand': si['startCommand'], 'latestDeployment': si['latestDeployment'],
           'PIPELINE_PAUSED': vs.get('PIPELINE_PAUSED'), 'PIPELINE_CMD': vs.get('PIPELINE_CMD'), 'INGEST_ONLY_KEYS': vs.get('INGEST_ONLY_KEYS')}
    out['services'][name] = row
    if row['cronSchedule'] != FROZEN:
        out['problems'].append(f"{name}: cron is {row['cronSchedule']!r}, not the freeze sentinel")
    if row['PIPELINE_PAUSED'] != '1':
        out['problems'].append(f"{name}: PIPELINE_PAUSED is {row['PIPELINE_PAUSED']!r}, not '1'")
    if row['INGEST_ONLY_KEYS']:
        out['problems'].append(f"{name}: leftover INGEST_ONLY_KEYS={row['INGEST_ONLY_KEYS']!r}")
print(json.dumps(out, indent=1))
sys.exit(1 if out['problems'] else 0)
