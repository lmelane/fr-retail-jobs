"""Refuse a deployment to main while a bounded production run is in flight on the aggregator service.

Incident 2026-09-09 18:35 UTC: the PR 60 auto-deploy replaced the validation deployment and stopped the running
Talentsoft/iCIMS container mid-write. Two independent witnesses are checked: the service's startCommand (a bounded
validation command carries INGEST_ONLY_KEYS) and the production PipelineRun table (any RUNNING row).

Exemptions are passed on the command line and never hard-coded. The previous version carried a literal run id in
the source; a run reappearing under that id — a restore from a dump, a replayed command — would have been waved
through in silence. `--allow-running <id>` makes any exemption deliberate, visible in the invocation, and reported
in the output. A run whose id is exempted is still PRINTED, never hidden.

usage: deploy-guard.py [--allow-running <pipelineRunId>]...
exit 0 = safe to deploy; exit 1 = refuse.
"""
import json
import subprocess
import sys

ENV = 'e66b019c-d280-41dc-85d8-25ed86bdd101'
SERVICE = '203613c5-701f-4013-a2c0-66c8de147c34'
NORMAL_COMMAND = 'sh apps/aggregator/start.sh'

allowed = {a for flag, a in zip(sys.argv, sys.argv[1:]) if flag == '--allow-running'}

r = subprocess.run(
    ['python3', 'backups/observability-20260909/railway-api.py'],
    input=json.dumps({
        'query': 'query($env:String!,$service:String!){serviceInstance(environmentId:$env,serviceId:$service){startCommand latestDeployment{id status}}}',
        'variables': {'env': ENV, 'service': SERVICE},
    }),
    text=True, capture_output=True, check=True,
)
si = json.loads(r.stdout)['serviceInstance']
cmd = si['startCommand'] or ''
problems = []
if 'INGEST_ONLY_KEYS=' in cmd or cmd != NORMAL_COMMAND:
    problems.append(f'aggregator startCommand is not the normal command: {cmd[:100]}')
if si['latestDeployment']['status'] not in ('SUCCESS', 'REMOVED', 'CRASHED', 'FAILED'):
    problems.append(f"aggregator latest deployment {si['latestDeployment']['status']}")

q = subprocess.run(
    ['python3', 'backups/remediation-20260908/run.py', 'readonly', 'npx', 'tsx', 'apps/aggregator/scripts/ops/running-pipeline-runs.mts'],
    text=True, capture_output=True,
)
running = [l for l in q.stdout.splitlines() if l.startswith('RUNNING ')]
if q.returncode:
    problems.append('could not read PipelineRun: ' + q.stderr[-300:])
# A run is exempt only if its id was named on the command line for THIS invocation.
exempted = [l for l in running if any(a in l for a in allowed)]
problems += [f'production run in flight: {l}' for l in running if l not in exempted]

print(json.dumps({
    'startCommand': cmd[:100],
    'latestDeployment': si['latestDeployment'],
    'runningRuns': running,
    'exempted': exempted,
    'problems': problems,
}, indent=1))
sys.exit(1 if problems else 0)
