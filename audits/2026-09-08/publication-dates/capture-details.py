"""Read actual undated official offers, with bounded concurrency and a host circuit breaker.
No database writes. Input is a private export of real JobSource rows, not generated jobs.
"""
import concurrent.futures, datetime, gzip, hashlib, json, pathlib, threading, urllib.request, urllib.error, urllib.parse, sys, time
base=pathlib.Path('backups/remediation-20260908')
out=base/'date-details';out.mkdir(exist_ok=True)
rows=json.load(open(base/'missing-dates.json'))['rows']
# One HTTP request per normalized detail URL. Preserve only the iCIMS rendering switch.
def key(r):
 u=urllib.parse.urlsplit(r['url'])
 if u.hostname.endswith('.icims.com'):return urllib.parse.urlunsplit((u.scheme,u.netloc,u.path,'in_iframe=1',''))
 return r['url']
groups={}
for r in rows:
 raw=r['raw']or{}
 if raw.get('publication_date')or raw.get('publicationTimestamp'):continue
 u=key(r);groups.setdefault(u,[]).append({'sourceKey':r['sourceKey'],'externalId':r['externalId'],'jobId':r['jobId']})
log=out/'captures.jsonl';done={}
if log.exists():
 for l in log.read_text().splitlines():
  r=json.loads(l);done[r['requestedUrl']]=r
if '--retry-skipped-icims' in sys.argv:
 done={u:r for u,r in done.items()if not (urllib.parse.urlsplit(u).hostname.endswith('.icims.com') and r['outcome']=='HOST_TRANSPORT_UNRESOLVED')}
lock=threading.Lock();limits={};failures={}
class RestrictedRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  u=urllib.parse.urlsplit(newurl)
  if u.scheme!='https' or u.username or u.password:raise ValueError('Unexpected redirect')
  return super().redirect_request(req,fp,code,msg,headers,newurl)
opener=urllib.request.build_opener(RestrictedRedirect())
def work(pair):
 u,subjects=pair;host=urllib.parse.urlsplit(u).hostname
 with lock: sem=limits.setdefault(host,threading.Semaphore(2))
 with sem:
  with lock:
   blocked=failures.get(host,0)>=3
  r={'requestedUrl':u,'subjects':subjects,'at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
  if blocked:r['outcome']='HOST_TRANSPORT_UNRESOLVED';return r
  try:
   req=urllib.request.Request(u,headers={'User-Agent':'Catwalks-production-audit/1.0'})
   with opener.open(req,timeout=20)as q:
    b=q.read(4_000_001);r.update(status=q.status,finalUrl=q.url,bytes=len(b))
    if q.status!=200 or not b:
     with lock:failures[host]=failures.get(host,0)+1
     r['outcome']='UNEXPECTED_HTTP_OR_EMPTY';return r
    if len(b)>4_000_000:raise ValueError('HTML exceeds capture limit')
    h=hashlib.sha256(b).hexdigest();p=out/(h+'.html.gz');p.write_bytes(gzip.compress(b));r.update(outcome='CAPTURED',sha256=h,path=str(p))
    with lock:failures[host]=0
  except urllib.error.HTTPError as e:
   b=e.read(4_000_000);h=hashlib.sha256(b).hexdigest();p=out/(h+'.html.gz');p.write_bytes(gzip.compress(b))
   r.update(status=e.code,outcome='DETAIL_404_OR_410' if e.code in (404,410) else 'FETCH_ERROR',error=str(e),sha256=h,path=str(p))
   # A missing individual vacancy does not mean its entire portal is down.
   if e.code not in (404,410):
    with lock:failures[host]=failures.get(host,0)+1
  except Exception as e:
   r.update(outcome='FETCH_ERROR',error=str(e))
   with lock:failures[host]=failures.get(host,0)+1
  return r
pending=[p for p in groups.items()if p[0]not in done]
print(json.dumps({'urls':len(groups),'cached':len(done),'pending':len(pending)}),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as ex,log.open('a')as f:
 for i,r in enumerate(ex.map(work,pending),1):
  f.write(json.dumps(r,ensure_ascii=False)+'\n');f.flush()
  if i%100==0:print(json.dumps({'finished':i,'pendingTotal':len(pending),'lastSource':r['subjects'][0]['sourceKey'],'outcome':r['outcome']}),flush=True)
print('capture complete',flush=True)
