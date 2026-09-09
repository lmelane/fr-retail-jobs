"""Turn the unvisited URLs of the tracker into ONE research subject per host, with provenance.
2 614 URLs are not 2 614 portals: 177 hosts, 31 shared by several actors. Career-looking paths
are visited first; the full URL list and every (actor, from) provenance are kept alongside."""
import argparse, json, pathlib, re, collections
from urllib.parse import urlsplit
p = argparse.ArgumentParser(); p.add_argument('tracker'); p.add_argument('output_input'); p.add_argument('output_provenance'); p.add_argument('--max-per-host', type=int, default=15); a = p.parse_args()
T = json.load(open(a.tracker))
CAREER = re.compile(r'career|karriere|carriere|carri[èe]res|jobs?|emploi|recrut|talent|join|work-with|stellen|lavora|trabaja|vacatures|opportunit', re.I)
hosts = collections.defaultdict(lambda: {'urls': collections.OrderedDict(), 'actors': set(), 'labels': set()})
for t in T:
    for u in t['portalResearch'].get('unvisitedUrls', []):
        h = urlsplit(u).hostname
        if not h: continue
        e = hosts[h]; e['urls'].setdefault(u, set()).add(t['id']); e['actors'].add(t['id']); e['labels'].update(t['labels'][:1])
subjects, provenance = [], []
for h, e in sorted(hosts.items(), key=lambda kv: -len(kv[1]['urls'])):
    urls = list(e['urls'])
    ranked = sorted(urls, key=lambda u: (0 if CAREER.search(u) else 1, len(u)))
    visit = ranked[:a.max_per_host]
    subjects.append({'id': f'host-{re.sub(r"[^a-z0-9]+", "-", h)}', 'name': h, 'labels': sorted(e['labels'])[:5], 'profileUrls': [], 'urls': visit, 'origin': 'UNVISITED_URL_DEDUP'})
    provenance.append({'host': h, 'subjectId': subjects[-1]['id'], 'actors': sorted(e['actors']), 'urlCount': len(urls), 'visitedNow': len(visit), 'deferred': len(urls) - len(visit),
                       'urls': [{'url': u, 'actors': sorted(ids), 'selected': u in visit} for u, ids in e['urls'].items()]})
pathlib.Path(a.output_input).write_text(json.dumps(subjects, ensure_ascii=False, indent=1))
pathlib.Path(a.output_provenance).write_text(json.dumps(provenance, ensure_ascii=False, indent=1))
print(json.dumps({'urls': sum(len(e['urls']) for e in hosts.values()), 'hosts': len(hosts), 'subjects': len(subjects), 'urlsSelected': sum(len(s['urls']) for s in subjects), 'deferred': sum(x['deferred'] for x in provenance), 'sharedHosts': sum(1 for e in hosts.values() if len(e['actors']) > 1)}))
