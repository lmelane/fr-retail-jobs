"""Time per stage, requests avoided, dossiers resolved and technical failures, from the artefacts the tools leave behind.
Reads research.jsonl files (per-subject `at`/`finishedAt`), probe logs/receipts, orchestrator metrics; never estimates."""
import json, glob, pathlib, collections, datetime, sys
B = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'backups/lot4-20260909'); out = {'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'stages': {}}
def span(rows):
    ts = sorted(t for r in rows for t in [r.get('at'), r.get('finishedAt')] if t)
    return {'from': ts[0], 'to': ts[-1], 'seconds': round((datetime.datetime.fromisoformat(ts[-1].replace('Z', '+00:00')) - datetime.datetime.fromisoformat(ts[0].replace('Z', '+00:00'))).total_seconds())} if ts else None
for d in sorted(B.glob('portal-*/research.jsonl')):
    rows = [json.loads(l) for l in open(d) if l.strip()]
    out['stages'][d.parent.name] = {'type': 'research', 'subjects': len({r['id'] for r in rows}), 'span': span(rows), 'statuses': dict(collections.Counter(r.get('status') for r in rows)),
        'pagesRead': sum(len(r.get('pages', [])) for r in rows), 'failures': sum(len(r.get('failures', [])) for r in rows), 'atsCandidates': sum(len(p.get('atsCandidates', [])) for r in rows for p in r.get('pages', []))}
for d in sorted(B.glob('source-probes*')):
    if not d.is_dir(): continue
    rcs = [json.load(open(f)) for f in d.glob('*.receipt.json')]
    if not rcs: continue
    secs = [(datetime.datetime.fromisoformat(r['finishedAt'].replace('Z', '+00:00')) - datetime.datetime.fromisoformat(r['startedAt'].replace('Z', '+00:00'))).total_seconds() for r in rcs if r.get('finishedAt') and r.get('startedAt')]
    out['stages'][d.name] = {'type': 'probe', 'sources': len(rcs), 'statuses': dict(collections.Counter(r.get('status') for r in rcs)), 'revisions': dict(collections.Counter((r.get('revision') or '')[:7] for r in rcs)),
        'span': span([{'at': r.get('startedAt'), 'finishedAt': r.get('finishedAt')} for r in rcs]), 'sourceSecondsTotal': round(sum(secs)), 'postingsFetched': sum(int(r.get('fetched') or 0) for r in rcs)}
for m in sorted(B.glob('*.metrics.json')):
    out['stages'][f'orchestrator:{m.stem}'] = json.load(open(m))
rec = B / 'completeness-reconciliation.json'
if rec.exists():
    r = json.load(open(rec))['summary']; out['completeness'] = {k: r.get(k) for k in ['activeSources', 'latestReceiptComplete', 'categories', 'toInvestigate', 'regressed', 'previousResolved']}
json.dump(out, open(B / 'qualification-metrics.json', 'w'), indent=1, ensure_ascii=False); print(json.dumps(out, indent=1, ensure_ascii=False)[:3000])
