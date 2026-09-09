"""Persistent, resumable, parallel runner for read-only discovery and technical qualification.

Nothing here writes to the database or activates a source. It schedules the existing
evidence tools, skips work whose evidence already exists at the current code revision
(requests avoided), runs independent stages in parallel (each tool keeps its own polite
per-host concurrency), persists progress after every task so a stopped run resumes where
it was, and measures time, work done, work avoided and technical failures per stage.

Plan (JSON): {"stages": [{"id": "...", "type": "probe"|"research", ...}]}
  probe    : {"keys": [...] | "kinds": [...], "snapshot": path, "output": dir}
             → one subprocess per source key via probe-sources.py; a key is SKIPPED when a receipt
               exists in `output` with the current revision and the current configHash.
  research : {"input": subjects.json, "output": dir, "mode": "known"|"all"|"profiles"}
             → research-portals.mts, which already skips subjects recorded in research.jsonl.
State (JSON, next to the plan): per stage status/timings/counters; per probe key the last outcome.
Usage: orchestrate.py plan.json --parallel 3 [--resume]
"""
import argparse, json, pathlib, subprocess, time, hashlib, os, collections, datetime, concurrent.futures as cf

p = argparse.ArgumentParser(); p.add_argument('plan'); p.add_argument('--parallel', type=int, default=3); p.add_argument('--resume', action='store_true'); a = p.parse_args()
PLAN = pathlib.Path(a.plan); plan = json.load(open(PLAN)); STATE = PLAN.with_suffix('.state.json'); METRICS = PLAN.with_suffix('.metrics.json')
state = json.load(open(STATE)) if STATE.exists() and a.resume else {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'stages': {}}
REV = subprocess.run(['git', 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(): STATE.write_text(json.dumps(state, indent=1, ensure_ascii=False))

def config_hash(cfg): return hashlib.sha256(json.dumps(cfg, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

ADAPTER_DIR = pathlib.Path('apps/aggregator/src/ats/adapters')
def adapter_paths(kind):
    """Files whose change invalidates a receipt for this kind; unknown kinds fall back to every adapter."""
    candidates = [ADAPTER_DIR / f'{kind}.ts', ADAPTER_DIR / f"{kind.replace('-', '')}.ts", ADAPTER_DIR / f"{kind.split('-')[0]}.ts"]
    own = [str(c) for c in candidates if c.exists()]
    return (own or [str(ADAPTER_DIR)]) + ['apps/aggregator/src/lib', 'apps/aggregator/src/types.ts', 'apps/aggregator/src/connectors/generic', 'apps/aggregator/src/ats/index.ts']
_unchanged = {}
def evidence_current(receipt, kind, cfg):
    """A receipt is current evidence when its configuration is the current one AND no file that produces this
    kind of receipt changed between its revision and HEAD (an older revision with an untouched adapter is as good
    as a fresh run — that is a request avoided, not a shortcut)."""
    if receipt.get('configHash') != config_hash(cfg): return False
    rev = receipt.get('revision') or ''
    if rev == REV: return True
    key = (rev, kind)
    if key not in _unchanged:
        _unchanged[key] = subprocess.run(['git', 'diff', '--quiet', rev, REV, '--', *adapter_paths(kind)], capture_output=True).returncode == 0
    return _unchanged[key]

def probe_stage(stage):
    snap = json.load(open(stage['snapshot'])); sources = {s['key']: s for s in snap['sources'] if s['status'] == 'ACTIVE'}
    keys = stage.get('keys') or [k for k, s in sources.items() if s['kind'] in stage.get('kinds', [])]
    out = pathlib.Path(stage['output']); out.mkdir(parents=True, exist_ok=True)
    st = state['stages'].setdefault(stage['id'], {'type': 'probe', 'keys': {}, 'done': 0, 'skipped': 0, 'failed': 0, 'requestsAvoided': 0})
    st.update({'status': 'RUNNING', 'startedAt': st.get('startedAt') or now(), 'total': len(keys)}); save()
    for key in keys:
        entry = st['keys'].setdefault(key, {})
        receipt = out / f'{key}.receipt.json'
        # Dedup: a receipt at the current revision for the current configuration is current evidence.
        if receipt.exists():
            r = json.load(open(receipt))
            if evidence_current(r, sources[key]['kind'], sources[key]['config']):
                if entry.get('status') != 'SKIPPED_CURRENT': st['skipped'] += 1; st['requestsAvoided'] += int(r.get('fetched') or 0) + 1
                entry.update({'status': 'SKIPPED_CURRENT', 'receipt': str(receipt), 'receiptRevision': r.get('revision'), 'receiptStatus': r.get('status')}); save(); continue
        if entry.get('status') == 'DONE' and entry.get('revision') == REV: continue
        t0 = time.time()
        proc = subprocess.run(['python3', 'apps/aggregator/src/coverage/probe-sources.py', stage['snapshot'], str(out), '--concurrency', '1', '--keys', key], capture_output=True, text=True)
        dt = round(time.time() - t0, 1)
        r = json.load(open(receipt)) if receipt.exists() else None
        ok = proc.returncode == 0 and r is not None and r.get('status') in ('FETCH_COMPLETE', 'FETCH_PARTIAL_OR_UNPROVEN')
        entry.update({'status': 'DONE' if ok else 'FAILED', 'revision': REV, 'seconds': dt, 'at': now(), 'receiptStatus': r and r.get('status'), 'fetched': r and r.get('fetched'), 'declaredTotal': r and r.get('declaredTotal'), 'error': None if ok else (proc.stderr or proc.stdout)[-400:]})
        st['done' if ok else 'failed'] += 1; st['secondsSpent'] = round(st.get('secondsSpent', 0) + dt, 1); save()
    st.update({'status': 'FINISHED', 'finishedAt': now()}); save()

def research_stage(stage):
    st = state['stages'].setdefault(stage['id'], {'type': 'research'})
    out = pathlib.Path(stage['output']); log = out.with_suffix('.orchestrator.log')
    before = sum(1 for _ in open(out / 'research.jsonl')) if (out / 'research.jsonl').exists() else 0
    subjects = len(json.load(open(stage['input'])))
    st.update({'status': 'RUNNING', 'startedAt': st.get('startedAt') or now(), 'subjects': subjects, 'recordedBefore': before}); save()
    t0 = time.time()
    with open(log, 'a') as fh:
        proc = subprocess.run(['npx', 'tsx', 'apps/aggregator/src/coverage/research-portals.mts', stage['input'], str(out), stage.get('mode', 'known')], stdout=fh, stderr=subprocess.STDOUT, text=True)
    rows = [json.loads(l) for l in open(out / 'research.jsonl') if l.strip()] if (out / 'research.jsonl').exists() else []
    st.update({'status': 'FINISHED' if proc.returncode == 0 else 'FAILED', 'exitCode': proc.returncode, 'finishedAt': now(), 'secondsSpent': round(time.time() - t0, 1),
               'recordedAfter': len(rows), 'requestsAvoided': before, 'statuses': dict(collections.Counter(r.get('status') for r in rows)),
               'pagesRead': sum(len(r.get('pages', [])) for r in rows), 'failures': sum(len(r.get('failures', [])) for r in rows), 'interrupted': sum(1 for r in rows if r.get('status') == 'RESEARCH_INTERRUPTED')}); save()

def run(stage):
    try: (probe_stage if stage['type'] == 'probe' else research_stage)(stage)
    except Exception as e:
        state['stages'].setdefault(stage['id'], {}).update({'status': 'FAILED', 'error': str(e)[:400], 'finishedAt': now()}); save()

pending = [s for s in plan['stages'] if state['stages'].get(s['id'], {}).get('status') != 'FINISHED']
with cf.ThreadPoolExecutor(max_workers=a.parallel) as pool: list(pool.map(run, pending))
state['finishedAt'] = now(); save()
metrics = {'revision': REV, 'startedAt': state['startedAt'], 'finishedAt': state['finishedAt'], 'stages': {k: {x: v.get(x) for x in ['type', 'status', 'startedAt', 'finishedAt', 'secondsSpent', 'total', 'done', 'skipped', 'failed', 'requestsAvoided', 'subjects', 'recordedBefore', 'recordedAfter', 'statuses', 'pagesRead', 'failures', 'interrupted']} for k, v in state['stages'].items()}}
METRICS.write_text(json.dumps(metrics, indent=1, ensure_ascii=False)); print(json.dumps(metrics, indent=1, ensure_ascii=False))
