"""Five separate proof dimensions per ACTIVE source, from archived evidence only (no network, no ingestion):
 1. identity      — portal identity certified for the CURRENT configuration (SourceIdentityReview VERIFIED, hash = current)
 2. enumeration   — exhaustive enumeration demonstrated by the adapter (complete, not truncated) on the latest receipt for the current config
 3. collection    — complete collection: enumeration proven AND zero gap (a rejected row stays in the gap even when its cause is known)
 4. details       — every collected posting carries description, date, location and country (receipt quality counters)
 5. ingestion     — production run and database in sync with the receipt (latest SourceRun, missing/absent counts)
 Visibility on the public site is NOT derivable from archives: it is listed as a live control unless a parity proof exists.
Usage: proof-dimensions.py snapshot.json output-dir --probes dir [dir…] [--parity json…]
"""
import argparse, json, pathlib, subprocess, csv, gzip, functools, collections
p = argparse.ArgumentParser(); p.add_argument('snapshot'); p.add_argument('output'); p.add_argument('--probes', nargs='*', default=[]); p.add_argument('--parity', nargs='*', default=[])
a = p.parse_args(); out = pathlib.Path(a.output); out.mkdir(parents=True, exist_ok=True)
snap = json.load(open(a.snapshot))
sources = {s['key']: s for s in snap['sources']}
reviews = {r['sourceKey']: r for r in snap.get('latestIdentityReviews', [])}
runs = {}
for r in snap.get('latestRuns', []):
    runs.setdefault(r['sourceKey'], r)
active_db = collections.Counter(pp['sourceKey'] for pp in snap.get('sourcePostings', []) if pp['isActive'] and pp['job']['isActive'])

@functools.lru_cache(maxsize=None)
def revision_date(rev):
    if not rev: return ''
    try: return subprocess.run(['git', 'show', '-s', '--format=%ct', rev], capture_output=True, text=True, check=True).stdout.strip().rjust(12, '0')
    except Exception: return ''

def config_hash(cfg):
    import hashlib
    return hashlib.sha256(json.dumps(cfg, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

# latest receipt per source for the CURRENT configuration (fallback: latest receipt at all, flagged)
receipts = {}
for d in a.probes:
    for f in pathlib.Path(d).glob('*.receipt.json'):
        try: r = json.load(open(f))
        except Exception: continue
        key = r.get('sourceKey');
        if key not in sources: continue
        cur = config_hash(sources[key].get('config') or {})
        rank = (1 if r.get('configHash') == cur else 0, revision_date(r.get('revision')), r.get('finishedAt') or '')
        if key not in receipts or rank > receipts[key][0]: receipts[key] = (rank, r, str(f))

def parity_companies():
    names = set()
    for f in a.parity:
        try:
            d = json.load(open(f)); b = d.get('brands') or d.get('companies') or {}
            for name, v in (b.items() if isinstance(b, dict) else []):
                if v.get('parity') is True: names.add(name.lower())
        except Exception: pass
    return names
parity = parity_companies()

rows = []
for key, s in sorted(sources.items()):
    if s['status'] != 'ACTIVE': continue
    rev = reviews.get(key)
    identity = 'CERTIFIED_CURRENT' if rev and rev.get('verdict') == 'VERIFIED' and rev.get('sourceHash') == s.get('identityHash') else ('CERTIFIED_STALE_CONFIG' if rev and rev.get('verdict') == 'VERIFIED' else 'LEGACY_UNCERTIFIED')
    entry = receipts.get(key)
    r = entry[1] if entry else None
    receipt_for_current = bool(entry and entry[0][0] == 1)
    run0 = runs.get(key)
    # No probe receipt for the current configuration: a production SourceRun taken after the configuration
    # was last updated is the receipt for that configuration (adapter flags, no per-posting quality counters).
    if not receipt_for_current and run0 and run0.get('ranAt') and run0['ranAt'] >= (s.get('updatedAt') or '') and run0.get('complete') is not None:
        r = {'complete': run0.get('complete'), 'truncated': run0.get('truncated'), 'fetched': run0.get('fetched'), 'uniqueIds': run0.get('fetched'), 'declaredTotal': run0.get('declaredTotal'), 'rejectedRows': None,
             'enumeration': {'issues': ['PRODUCTION_RUN_RECEIPT'] + ([] if run0.get('complete') else ['ENUMERATION_NOT_PROVEN'])}, 'quality': None, 'revision': 'production-run', 'finishedAt': run0['ranAt'], 'productionRun': True}
        receipt_for_current = True
    if not r:
        enumeration = 'NO_RECEIPT'; collection = 'NO_RECEIPT'; deficit = 'UNKNOWN'; gap = None; rejected = None; details = 'NO_RECEIPT'; issues = ''; fetched = None; declared = None
    else:
        e = r.get('enumeration') or {}
        fetched = r.get('uniqueIds') if r.get('uniqueIds') is not None else r.get('fetched'); declared = r.get('declaredTotal'); rejected = r.get('rejectedRows') or 0
        issues = ','.join(e.get('issues') or [])
        proven = bool(r.get('complete')) and not r.get('truncated')
        enumeration = 'EXHAUSTIVE_PROVEN' if proven else ('NOT_PROVEN' if r.get('complete') is not None else 'NO_ADAPTER_PROOF')
        counter_gap = (declared - fetched) if (isinstance(declared, int) and declared >= 0 and isinstance(fetched, int)) else None
        gap = max(counter_gap or 0, rejected) if counter_gap is not None else rejected
        collection = 'COMPLETE' if proven and gap == 0 else ('INCOMPLETE_EXPLAINED' if gap and (issues or rejected) else ('INCOMPLETE' if gap else 'NOT_PROVEN'))
        deficit = 'NONE' if not gap else ('EXPLAINED' if (issues or rejected) else 'UNEXPLAINED')
        q = r.get('quality')
        if q is None and r.get('productionRun'):
            rates = {k: run0.get(k) for k in ('descriptionRate', 'dateRate', 'countryRate', 'urlRate')}
            details = 'COMPLETE' if all(v == 1 for v in rates.values()) else 'PARTIAL:' + ','.join(f'{k}={v}' for k, v in rates.items() if v != 1)
        else:
            q = q or {}
            miss = {k: v for k, v in q.items() if k in ('missingDescription', 'missingDate', 'missingLocation', 'missingCountry', 'missingId', 'missingTitle', 'invalidUrl') and v}
            details = 'COMPLETE' if not miss and fetched else ('EMPTY' if not fetched else 'PARTIAL:' + ','.join(f'{k}={v}' for k, v in miss.items()))
    run = runs.get(key)
    if r and run and not r.get('productionRun'):
        missing_db = len(r.get('missingInDatabase') or []); absent = len(r.get('activeDatabaseAbsentAtSource') or [])
        ingestion = f"RUN_{run.get('status')}" + (';IN_SYNC' if missing_db == 0 and absent == 0 else f';missingInDb={missing_db};absentAtSource={absent}')
    elif run and r and r.get('productionRun'): ingestion = f"RUN_{run.get('status')};PRODUCTION_RUN_IS_THE_RECEIPT"
    elif run: ingestion = f"RUN_{run.get('status')};NO_RECEIPT_COMPARISON"
    else: ingestion = 'NO_RUN'
    maison = (s.get('maison') or '').lower()
    visibility = 'PARITY_PROVEN' if maison in parity else 'LIVE_CONTROL_REQUIRED'
    rows.append({'sourceKey': key, 'kind': s['kind'], 'maison': s.get('maison'), 'identity': identity, 'receiptForCurrentConfig': receipt_for_current, 'receiptRevision': (r or {}).get('revision', '')[:8] if r else '', 'receiptAt': (r or {}).get('finishedAt', '') if r else '',
                 'enumeration': enumeration, 'fetched': fetched, 'declaredTotal': declared, 'rejectedRows': rejected, 'gap': gap, 'deficit': deficit, 'issues': issues, 'collection': collection, 'details': details, 'ingestion': ingestion, 'activeInDatabase': active_db.get(key, 0), 'visibility': visibility})

with open(out / 'sources-proof-dimensions.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
summary = {'activeSources': len(rows), 'note': 'Each dimension is separate. An explained deficit is not a complete collection; a rejected row stays in the gap. Receipts are the latest for the CURRENT configuration when one exists.',
           'identity': dict(collections.Counter(x['identity'] for x in rows)), 'enumeration': dict(collections.Counter(x['enumeration'] for x in rows)), 'collection': dict(collections.Counter(x['collection'] for x in rows)),
           'deficit': dict(collections.Counter(x['deficit'] for x in rows)), 'details': dict(collections.Counter('COMPLETE' if x['details'] == 'COMPLETE' else ('NO_RECEIPT' if x['details'] == 'NO_RECEIPT' else 'PARTIAL') for x in rows)),
           'ingestionInSync': sum(1 for x in rows if 'IN_SYNC' in x['ingestion']), 'ingestionRunStatus': dict(collections.Counter(x['ingestion'].split(';')[0] for x in rows)), 'visibility': dict(collections.Counter(x['visibility'] for x in rows)),
           'receiptsForCurrentConfig': sum(1 for x in rows if x['receiptForCurrentConfig']), 'allFiveProven': sum(1 for x in rows if x['identity'] == 'CERTIFIED_CURRENT' and x['collection'] == 'COMPLETE' and x['details'] == 'COMPLETE' and 'IN_SYNC' in x['ingestion'] and x['visibility'] == 'PARITY_PROVEN'),
           'collectionCompleteAndDetailsComplete': sum(1 for x in rows if x['collection'] == 'COMPLETE' and x['details'] == 'COMPLETE'),
           'gapTotalPostings': sum(x['gap'] or 0 for x in rows if isinstance(x['gap'], int))}
json.dump(summary, open(out / 'proof-dimensions-summary.json', 'w'), indent=1, ensure_ascii=False); print(json.dumps(summary, indent=1, ensure_ascii=False))
