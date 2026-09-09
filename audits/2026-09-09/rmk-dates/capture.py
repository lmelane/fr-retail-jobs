"""Read actual employer details, bounded to two concurrent requests; no ingestion."""
import json,pathlib,urllib.request,concurrent.futures,hashlib,datetime,gzip
p=pathlib.Path('backups/remediation-20260909/rmk-dates');x=json.loads((p/'before.json').read_text()); seen=set();rows=[]
for s in x['sources']:
 r=s['raw'];locale=r.get('locale');k=(s['sourceKey'],locale)
 if locale=='en_US' or k not in seen:rows.append(s);seen.add(k)
def get(s):
 out={'sourceId':s['id'],'url':s['url'],'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  req=urllib.request.Request(s['url'],headers={'User-Agent':'Catwalks-SourceAudit/1.0 (+https://modecareers.com)'})
  with urllib.request.urlopen(req,timeout=30) as r:
   b=r.read(3000001);assert len(b)<=3000000;out.update(status=r.status,finalUrl=r.url,sha256=hashlib.sha256(b).hexdigest())
   path=p/(s['id']+'.html.gz');path.write_bytes(gzip.compress(b));out['capture']=str(path)
 except Exception as e:out['error']=str(e)
 return out
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: result=list(pool.map(get,rows))
(p/'captures.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
