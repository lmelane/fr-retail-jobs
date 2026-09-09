import json,urllib.request,urllib.parse,hashlib,datetime,sys,pathlib
out=pathlib.Path(sys.argv[1]); pages=[]
for query in ['pays=FR','pays=FR&ville=Tourcoing&q=Quality%20Control%20Associated','q=Quality%20Control%20Associated&ville=Tourcoing']:
 url='https://modecareers.com/api/jobs?'+query
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'CatwalksProductionAudit/1.0'}),timeout=45) as r:
  b=r.read();data=json.loads(b)
  pages.append({'url':url,'status':r.status,'sha256':hashlib.sha256(b).hexdigest(),'total':data['total'],'totalInDatabase':data['totalInDatabase'],'sampleIds':[j['id'] for j in data['jobs']],'countryFacets':data['facets']['countries']})
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'pages':pages}
out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps([{k:p[k] for k in ['url','status','total','totalInDatabase']} for p in pages]))
