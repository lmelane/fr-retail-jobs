import json,collections,re,unicodedata,datetime,urllib.parse,csv
from pathlib import Path
base=Path(__file__).parent;ev=base/'evidence'
load=lambda n:json.loads((ev/(n+'.json')).read_text())
save=lambda n,x:(ev/(n+'.json')).write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
jobs=load('job-metadata');active=[j for j in jobs if j['isActive']];companies=load('companies');cm={c['id']:c for c in companies};sources=load('sources');sm={s['key']:s for s in sources};links=load('company-source-links');runs=load('latest-runs');rm={r['sourceKey']:r for r in runs};now=datetime.datetime.fromisoformat(load('snapshot')[0]['at'])
def norm(x):return re.sub(r'[^a-z0-9]+',' ',unicodedata.normalize('NFKD',x or '').encode('ascii','ignore').decode().lower()).strip()
def urlkey(u):
 try:
  p=urllib.parse.urlsplit(u); q=[(k,v) for k,v in urllib.parse.parse_qsl(p.query) if not k.lower().startswith('utm_') and k.lower() not in ['source','sourceid','ref','referrer','gh_src']];return urllib.parse.urlunsplit((p.scheme,p.netloc.lower(),p.path.rstrip('/'),urllib.parse.urlencode(sorted(q)),''))
 except:return u
def age(x):return (now-datetime.datetime.fromisoformat(x).replace(tzinfo=datetime.timezone.utc)).total_seconds()/3600 if x else None
def sample(j):return {**{k:j.get(k) for k in ['id','title','countryCode','isFrance','city','location','url','externalId','source','postedAt','firstSeenAt','lastSeenAt','validThrough','jobFunction','seniority','canonicalSourceKey','description_hash','description_length']},'company':cm[j['companyId']]['name']}
def groups(key,condition=lambda j:True):
 g=collections.defaultdict(list)
 for j in active:
  if condition(j):g[key(j)].append(j)
 return [v for v in g.values() if len(v)>1]
sets={
 'exact-url':groups(lambda j:urlkey(j['url'])),
 'fingerprint':groups(lambda j:(j['companyId'],j['fingerprint']),lambda j:bool(j['fingerprint'])),
 'same-title-city-country':groups(lambda j:(j['companyId'],norm(j['title']),norm(j['city']),j['countryCode']),lambda j:bool(j['city'])),
 'same-text-title-city-country':groups(lambda j:(j['companyId'],norm(j['title']),norm(j['city']),j['countryCode'],j['description_hash']),lambda j:bool(j['city']) and (j['description_length'] or 0)>200),
 'same-ats-external-id':groups(lambda j:(j['companyId'],j['source'],j['externalId']))}
dups={}
for name,gs in sets.items():
 gs.sort(key=len,reverse=True);dups[name]={'clusters':len(gs),'involved':sum(map(len,gs)),'excess_if_all_duplicates':sum(len(g)-1 for g in gs),'examples':[[sample(j) for j in g] for g in gs[:30]]};save('duplicates-'+name,[[sample(j) for j in g] for g in gs])
save('duplicate-summary',dups)
activecl={x['companyId'] for x in links if x['status']=='ACTIVE'}
activefootprints={x['companyId'] for x in links if x['status']=='ACTIVE' and x['active']>0}
canonicaldup=collections.defaultdict(list)
for c in companies:canonicaldup[c['canonicalKey']].append(c)
summary={'companies':len(companies),'companies_with_active_jobs':sum(c['active']>0 for c in companies),'companies_kinds':dict(collections.Counter(c['kind'] for c in companies)),'companies_sectors':dict(collections.Counter(c['sector'] for c in companies)),'active_companies_kinds':dict(collections.Counter(c['kind'] for c in companies if c['active'])),'parent_groups_all':len({c['parentGroup'] for c in companies if c['parentGroup']}),'parent_groups_active':len({c['parentGroup'] for c in companies if c['active'] and c['parentGroup']}),'sources_status':dict(collections.Counter(s['status'] for s in sources)),'active_sources_kinds':dict(collections.Counter(s['kind'] for s in sources if s['status']=='ACTIVE')),'active_sources_zero_jobs':sum(s['active_jobs']==0 and s['status']=='ACTIVE' for s in sources),'companies_no_active_source_historical_footprint':len(companies)-len(activecl),'active_companies_no_active_catalogue_footprint':sum(c['active']>0 and c['id'] not in activefootprints for c in companies),'company_canonical_duplicate_keys':sum(len(v)>1 for v in canonicaldup.values()),'company_aliases':sum(len(c['aliases'] or []) for c in companies),'active_jobs_unknown_company_kind':sum(j['isActive'] and cm[j['companyId']]['kind']=='UNKNOWN' for j in jobs),'active_jobs_unknown_company_sector':sum(cm[j['companyId']]['sector']=='UNKNOWN' for j in active),'active_jobs_missing_company_domain':sum(not cm[j['companyId']]['domain'] for j in active),'active_jobs_no_canonical_owner':sum(not j['canonicalSourceKey'] or not j['canonicalExternalId'] for j in active),'active_jobs_no_canonical_observation':sum(not j['observation_count'] for j in active),'france_flag_disagreement':sum(j['isFrance']!=(j['countryCode']=='FR') for j in active),'countries':len({j['countryCode'] for j in active if j['countryCode']}),'taxonomies':dict(collections.Counter(j['taxonomyVersion'] for j in active))}
for field in ['jobFunction','seniority','workplaceType','employmentTerm','programType','workTime']:
 summary[field]=dict(collections.Counter(j[field] for j in active))
save('analysis-summary',summary)
save('company-duplicate-identities',[v for v in canonicaldup.values() if len(v)>1])
save('companies-without-active-source-footprint',[c for c in companies if c['id'] not in activecl])
save('france-flag-mismatch',[sample(j) for j in active if j['isFrance']!=(j['countryCode']=='FR')])
save('future-dates',[sample(j)|{'raw':j['raw_geo_date']} for j in active if j['postedAt'] and age(j['postedAt']) < -24])
save('expired-active',[sample(j) for j in active if j['validThrough'] and age(j['validThrough'])>0])
# Location-only hints are review candidates, never inferred corrections.
save('france-location-review',[sample(j)|{'raw':j['raw_geo_date']} for j in active if j['countryCode']!='FR' and re.search(r'\b(france|paris|lyon|marseille|bordeaux|toulouse|lille|nantes|strasbourg|roubaix|serris|saint.tropez|cannes)\b',j['location'] or '',re.I)])
per=[]
for s in sources:
 r=rm.get(s['key']); row={'key':s['key'],'maison':s['maison'],'status':s['status'],'kind':s['kind'],'active':s['active_jobs'],'fr':s['fr_jobs'],'run_status':r['status'] if r else None,'run_age_hours':round(age(r['ranAt']),2) if r else None,'complete':r['complete'] if r else None,'canAttestAbsence':r['canAttestAbsence'] if r else None,'previousJobs':r['previousJobs'] if r else None,'jobs':r['jobs'] if r else None,'note':r['note'] if r else None,'robots':s['robotsVerdict']};per.append(row)
save('source-health',per)
print(json.dumps(summary,ensure_ascii=False,indent=2))
print('DUPLICATE_CANDIDATES',json.dumps({k:{a:v[a] for a in ['clusters','involved','excess_if_all_duplicates']} for k,v in dups.items()}))
print('France hints',len(load('france-location-review')))
