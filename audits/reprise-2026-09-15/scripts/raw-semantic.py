import gzip,json,collections,re
root='/tmp/catwalks-audit-20260915/'
out=collections.defaultdict(collections.Counter); unique=collections.defaultdict(set); bysource=collections.defaultdict(collections.Counter)
paths=collections.defaultdict(collections.Counter)
def num(v):
 if isinstance(v,bool) or v is None or isinstance(v,(list,dict)):return None
 try:
  x=float(v);return x if str(v).strip() and abs(x)!=float('inf') else None
 except:return None
def money(v,lo,hi,curr,period):
 return (v.get(lo),v.get(hi),v.get(curr),v.get(period)) if isinstance(v,dict) else (None,)*4
def walk(v,path=''):
 if isinstance(v,dict):
  yield path,v
  for k,w in v.items():
   if k not in ['similarJobs','derivedInfo']:yield from walk(w,path+'/'+k)
 elif isinstance(v,list):
  for w in v:yield from walk(w,path+'/*')
for line in gzip.open(root+'raw-active-representations.jsonl.gz','rt'):
 r=json.loads(line);v=r['raw'] or {};kind=r['kind'];flags=set();salary=[];edu=[];geo=[];remote=[]
 if not isinstance(v,dict):continue
 if kind in ['recruitee','lvmh_algolia']:salary.append(money(v.get('salary'),'min','max','currency','period'))
 if kind=='lever':salary.append(money(v.get('salaryRange'),'min','max','currency','interval'))
 if kind=='personio':salary.append(money(v.get('salaryInformation'),'min','max','currencyCode','type'))
 if kind in ['wttj','wttj-sector']:salary.append(money(v,'salary_minimum','salary_maximum','salary_currency','salary_period'))
 if kind=='magnet':salary.append(money(v.get('salary'),'min_src','max_src','currency','periodicity'))
 for path,obj in walk(v):
  if 'baseSalary' in obj and isinstance(obj['baseSalary'],dict):
   b=obj['baseSalary'];val=b.get('value',b);val=val if isinstance(val,dict) else {'value':val};salary.append((val.get('minValue',val.get('value')),val.get('maxValue'),b.get('currency'),val.get('unitText')))
  for a,b in [('latitude','longitude'),('Latitude','Longitude'),('lat','lng'),('lat','lon'),('data-latitude','data-longitude')]:
   if a in obj and b in obj:
    x,y=num(obj[a]),num(obj[b]);
    if x is not None and y is not None and -90<=x<=90 and -180<=y<=180:
     if (x,y)==(0,0):flags.add('geo_zero_pair')
     else:geo.append((x,y));paths[kind]['geo:'+path]+=1
 if kind=='recruitee':edu=[v.get('education_code')]
 if kind in ['wttj','wttj-sector']:edu=[v.get('education_level')]
 if kind=='flatchr':edu=[v.get('vacancy',{}).get('education_level')]
 if kind=='workable':edu=[v.get('education')]
 edu=[x for x in edu if isinstance(x,str) and x.strip() and x.lower() not in ['unspecified','not_applicable','none']]
 if edu:flags.add('education_declared_value')
 if kind=='recruitee':
  if v.get('hybrid') is True:
   remote.append('hybrid')
   if v.get('remote') is False:
    flags.add('hybrid_remote_false')
    if r['canonicalSourceKey']==r['sourceKey'] and r['workplaceType']=='ONSITE':flags.add('hybrid_owned_persisted_onsite')
  elif v.get('remote') is True:remote.append('remote')
  elif v.get('on_site') is True:remote.append('onsite')
 if kind=='lvmh_algolia':remote=[v.get('workingMode')]
 if kind=='eightfold':remote=[v.get('workLocationOption')]
 if kind=='workday':remote=[v.get('detail',{}).get('jobPostingInfo',{}).get('remoteType')]
 if kind in ['lever','ashby']:remote=[v.get('workplaceType')]
 if kind=='smartrecruiters-whitelabel':
  loc=v.get('location') or {}
  if loc.get('hybrid') is True:remote=['hybrid']
  elif loc.get('remote') is True:remote=['remote']
 if any(isinstance(x,str) and x.strip() for x in remote):flags.add('workplace_explicit_signal')
 for lo,hi,cu,pe in salary:
  ns=[x for x in [num(lo),num(hi)] if x is not None and x>0]
  if ns:
   flags.add('salary_positive_amount')
   if any(x%1 for x in ns):flags.add('salary_has_decimals')
   if isinstance(cu,str) and re.fullmatch('[A-Z]{3}',cu):
    flags.add('salary_amount_currency')
    if isinstance(pe,str) and pe.strip():flags.add('salary_amount_currency_period')
 if geo:flags.add('geo_named_valid_pair')
 if len(set(geo))>1:flags.add('geo_multiple_distinct_pairs')
 flags.add('representations')
 for f in flags:
  out[kind][f]+=1;bysource[r['sourceKey']][f]+=1;unique[f].add(r['jobId'])
 for field,col in [('salary_positive_amount','salaryMin'),('education_declared_value','educationLevel'),('workplace_explicit_signal','workplaceType'),('geo_named_valid_pair','latitude')]:
  if field in flags and r[col] is None:out[kind][field+'_public_column_null']+=1
json.dump({'method':'Conservative typed selectors; salary tuple keeps currency and period; geo pairs named lat/lon excluding similarJobs/derivedInfo. Numeric plausibility does NOT certify address precision. Additional coordinate encodings remain in path inventory. Signals are not projected promises. Column-null comparison uses linked Job, not necessarily owner. Education excludes form flags; workplace false flags alone do not prove onsite.','representations':sum(x['representations'] for x in out.values()),'byKind':out,'bySource':bysource,'uniqueLinkedJobs':{k:len(v) for k,v in unique.items()},'geoPaths':paths},open(root+'raw-semantic.json','w'),indent=2)
print(json.dumps({k:len(v) for k,v in unique.items()}))
