"""Portfolio observations (official group pages) → research subjects, joined with the database by exact name/alias.
An observation is a listing on the group's own site, never an ownership inference. Brands with a known official
domain/careers URL get a research subject; the others are listed as 'official site to find'."""
import argparse, json, pathlib, unicodedata, collections
p = argparse.ArgumentParser(); p.add_argument('snapshot'); p.add_argument('output_input'); p.add_argument('output_report'); p.add_argument('--observations', nargs='+', required=True); a = p.parse_args()
snap = json.load(open(a.snapshot)); norm = lambda x: ' '.join(unicodedata.normalize('NFKC', x or '').lower().replace('®', '').split())
names = collections.defaultdict(set); companies = {c['id']: c for c in snap['companies']}
for c in companies.values():
    if c['mergedIntoId']: continue
    names[norm(c['name'])].add(c['id'])
    for al in c['aliases']: names[norm(al['displayName'])].add(c['id'])
counts = {r['companyId']: r for r in snap['counts']}; sources = collections.defaultdict(list)
for r in snap['sourceCompanies']: sources[r['companyId']].append(r['sourceKey'])
obs = []
for f in a.observations:
    d = json.load(open(f)); obs += d if isinstance(d, list) else d.get('observations', [])
subjects, report = [], []
seen = set()
for o in obs:
    key = (norm(o['name']), o.get('portfolioGroup') or o.get('group'))
    if key in seen: continue
    seen.add(key)
    ids = sorted(names.get(norm(o['name']), set()))
    urls = sorted({u if '://' in u else f'https://{u}/' for i in ids for u in [companies[i].get('domain'), companies[i].get('careersUrl')] if u})
    row = {'name': o['name'], 'group': o.get('portfolioGroup') or o.get('group'), 'relationship': o.get('relationship'), 'proofUrl': o.get('proofUrl'), 'artifactHash': o.get('artifactHash'), 'checkedAt': o.get('checkedAt'),
           'candidateCompanyIds': ids, 'candidateCompanies': [{'id': i, 'name': companies[i]['name'], 'activeJobs': counts.get(i, {}).get('world', 0), 'sources': sorted(set(sources.get(i, [])))} for i in ids],
           'urls': urls, 'status': 'RESEARCHABLE' if urls else ('IN_DATABASE_NO_DOMAIN' if ids else 'OFFICIAL_SITE_TO_FIND')}
    report.append(row)
    if urls: subjects.append({'id': f"pf-{norm(o['name']).replace(' ', '-')}-{norm(row['group'] or '').replace(' ', '-')}", 'name': o['name'], 'labels': [o['name']], 'profileUrls': [], 'urls': urls, 'origin': f"PORTFOLIO:{row['group']}"})
pathlib.Path(a.output_input).write_text(json.dumps(subjects, ensure_ascii=False, indent=1)); pathlib.Path(a.output_report).write_text(json.dumps(report, ensure_ascii=False, indent=1))
summary = {'observations': len(obs), 'distinct': len(report), 'byStatus': dict(collections.Counter(r['status'] for r in report)), 'byGroup': dict(collections.Counter(r['group'] for r in report)), 'withActiveSource': sum(1 for r in report if any(c['sources'] for c in r['candidateCompanies']))}
print(json.dumps(summary, ensure_ascii=False, indent=1))
