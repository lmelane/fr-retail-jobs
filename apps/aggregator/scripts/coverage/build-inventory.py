"""Reproducible candidate inventory; never certifies a name match or writes production."""
import argparse, collections, csv, hashlib, json, pathlib, re, unicodedata
p=argparse.ArgumentParser();p.add_argument('snapshot');p.add_argument('output');a=p.parse_args()
out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
root=pathlib.Path('audits/2026-09-09/lot4-world-coverage')
prod=json.load(open(a.snapshot)); benchmark=json.load(open('audits/2026-09-08/fashionjobs-world/employers.json'))
previous=json.load(open('audits/2026-09-08/fashionjobs-coverage/discovery-evidence.json'))
def norm(x):return ' '.join(unicodedata.normalize('NFKC',x).lower().split())
def digest(x):return hashlib.sha256(json.dumps(x,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:20]
companies={c['id']:c for c in prod['companies']}; names=collections.defaultdict(set)
for c in companies.values():
 if c['mergedIntoId']:continue
 names[norm(c['name'])].add(c['id'])
 for al in c['aliases']:names[norm(al['displayName'])].add(c['id'])
byPrevious={norm(r['name']):r for r in previous}
counts={r['companyId']:r for r in prod['counts']}; bySources=collections.defaultdict(list)
for r in prod['sourceCompanies']:bySources[r['companyId']].append(r['sourceKey'])
sources={s['key']:s for s in prod['sources']}
# Historical catalogues provide candidate domains only, with their exact row provenance.
historicalDomains=collections.defaultdict(list)
for file,delimiter,nameField,urlFields in [
 ('maisons_monde_input.csv',',','nom',['site']),
 ('maisons-domaines-loic.tsv','\t','Maison',['Site officiel']),
 ('export-maisons-etat.csv',',','maison',['site_web']),
]:
 path=pathlib.Path('apps/aggregator/data/imports')/file
 with path.open() as f:
  for line,row in enumerate(csv.DictReader(f,delimiter=delimiter),2):
   for field in urlFields:
    url=(row.get(field) or '').strip()
    if url and '.' in url and ' ' not in url:
     if '://' not in url:url='https://'+url+'/'
     if url.startswith(('https://','http://')):historicalDomains[norm(row.get(nameField,''))].append({'url':url,'file':str(path),'line':line,'name':row[nameField],'verdict':'CANDIDATE_NOT_OFFICIAL_IDENTITY_PROOF'})
rows=[]
for index,b in enumerate(benchmark):
 ids=set().union(*(names[norm(x)] for x in b['labels']))
 # Historical fuzzy/ASCII suggestions stay separate from current exact-name candidates.
 historical=[i for i in b.get('candidateCompanyIds',[]) if i in companies]
 histories=[byPrevious[norm(x)] for x in b['labels'] if norm(x) in byPrevious]
 candidateCompanies=[companies[i] for i in sorted(ids)]
 urls=set()
 for c in candidateCompanies:
  for u in [c['domain'],c['careersUrl']]:
   if u:urls.add(u if '://' in u else 'https://'+u+'/')
 for h in histories:
  urls.update(h.get('declaredWebsites',[]))
  urls.update(x['url'] for x in h.get('pages',[]) if x.get('url'))
  urls.update(x['url'] for x in h.get('failures',[]) if x.get('url') and 'fashionjobs.com' not in x['url'])
 domainEvidence=[e for label in b['labels'] for e in historicalDomains[norm(label)]]
 urls.update(e['url'] for e in domainEvidence)
 keys=sorted(set(k for i in ids for k in bySources[i]))
 row={'id':'fj-'+digest({'index':index,'labels':b['labels']}),'origin':'FASHIONJOBS_BENCHMARK','benchmarkIndex':index,
 'labels':b['labels'],'legacyKey':b['key'],'editions':b['editions'],'profiles':b['profiles'],
 'candidateCompanyIds':sorted(ids),'historicalCandidateCompanyIds':historical,
 'canonicalIdentityVerdict':'REVIEW_REQUIRED' if ids else 'NO_EXACT_NAME_OR_ALIAS_MATCH',
 'candidateCompanies':[{'id':c['id'],'name':c['name'],'kind':c['kind'],'parentGroup':c['parentGroup'],'sectors':c['sectorCodes'],'identityReviewId':c['identityReviewId']} for c in candidateCompanies],
 'candidateWebsites':sorted(urls),'historicalDomainCandidates':domainEvidence,'sourceKeys':keys,
 'activeJobsForSingleCandidate':counts.get(next(iter(ids)),{}).get('world',0) if len(ids)==1 else None,
 'franceJobsForSingleCandidate':counts.get(next(iter(ids)),{}).get('france',0) if len(ids)==1 else None,
 'previousResearch':histories,'latestDatabaseCheck':prod['at'],
 'status':'DISCOVERY_AND_IDENTITY_REVIEW_PENDING','nextAction':'Review official identity and all career portals; compare real source receipts. A name/alias match alone is not ownership proof.'}
 rows.append(row)
assert len(rows)==1653 and len({r['id'] for r in rows})==1653
(out/'fashionjobs-tracker.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
subjects=[{'id':r['id'],'name':r['labels'][0],'labels':r['labels'],'profileUrls':[p['url'] for p in r['profiles']], 'urls':r['candidateWebsites'],'origin':r['origin']} for r in rows]
(out/'research-input.json').write_text(json.dumps(subjects,ensure_ascii=False,indent=2))
with (out/'fashionjobs-tracker.csv').open('w') as f:
 w=csv.writer(f);w.writerow(['ID','Libellés RAW','Pays éditions','Entreprises candidates (pas certifiées)','Sources observées en BDD','Offres actives si candidat unique','France si candidat unique','Sites candidats','Statut','Action restante'])
 for r in rows:
  values=[r['id'],' | '.join(r['labels']),' | '.join(r['editions']),' | '.join(c['name'] for c in r['candidateCompanies']),' | '.join(r['sourceKeys']),r['activeJobsForSingleCandidate'],r['franceJobsForSingleCandidate'],' | '.join(r['candidateWebsites']),r['status'],r['nextAction']]
  w.writerow(["'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v for v in values])
summary={'databaseAt':prod['at'],'benchmarkRows':len(rows),'rawLabels':sum(len(r['labels']) for r in rows),'candidateWithExactNameOrAlias':sum(bool(r['candidateCompanyIds']) for r in rows),'candidateWithWebsites':sum(bool(r['candidateWebsites']) for r in rows),'candidateWithDbSource':sum(bool(r['sourceKeys']) for r in rows),'semanticallyQualifiedByThisJoin':0,'note':'These are candidate matches, not confirmed coverage or exhaustive research verdicts.'}
(out/'inventory-summary.json').write_text(json.dumps(summary,indent=2));print(summary)
