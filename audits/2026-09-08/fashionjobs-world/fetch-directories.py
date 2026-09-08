# Public edition/directory metadata only. No job-detail URLs followed.
import urllib.request,urllib.parse,re,json,pathlib,datetime,hashlib,concurrent.futures,argparse
from html.parser import HTMLParser
parser=argparse.ArgumentParser(description='Capture public FashionJobs employer directories, no job pages')
parser.add_argument('--output-dir',help='New snapshot directory, or existing one to resume')
args=parser.parse_args()
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
root=pathlib.Path(args.output_dir or f'backups/fashionjobs-world-{stamp}');root.mkdir(parents=True,exist_ok=True,mode=0o700)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def allowed(url):
 p=urllib.parse.urlsplit(url)
 if p.scheme!='https' or not re.fullmatch(r'[a-z]{2}\.fashionjobs\.com',p.hostname or '') or p.username or p.password or p.port not in (None,443):raise RuntimeError('OUT_OF_SCOPE_URL')
 if not re.fullmatch(r'/(?:[a-z]{2}-[a-z]{2}/)?(?:societesrecrutent/|firmenuebersicht/|zhaopinqiye/)?',p.path):raise RuntimeError('NOT_HOMEPAGE_OR_DIRECTORY')
class Redirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  allowed(newurl)
  return super().redirect_request(req,fp,code,msg,headers,newurl)
opener=urllib.request.build_opener(Redirect())
def fetch(url):
 allowed(url)
 r=opener.open(urllib.request.Request(url,headers={'User-Agent':'CatwalksJobsBot/0.1'}),timeout=20)
 b=r.read(8000000)
 if len(b)>=8000000:raise RuntimeError('BODY_LIMIT')
 return r.url,b.decode('utf-8'),hashlib.sha256(b).hexdigest()
class Nav(HTMLParser):
 def __init__(self):super().__init__();self.links=[]
 def handle_starttag(self,t,a):
  d=dict(a)
  if d.get('data-nav')=='les_entreprises' and d.get('data-link'):self.links.append(d['data-link'])
  if t=='a' and any(v in d.get('href','') for v in ['/societesrecrutent/','/zhaopinqiye/','/firmenuebersicht/']):self.links.append(d['href'])
url='https://uk.fashionjobs.com/';final,s,h=fetch(url);hosts=sorted(set(re.findall(r'https?://([a-z]+)\.fashionjobs\.com',s)))
(root/'edition-discovery.json').write_text(json.dumps({'at':now(),'page':url,'hash':h,'hosts':hosts,'transport':'Python urllib, same declared CatwalksJobsBot UA; Node public transport returned 403'},indent=2))
def run(edition):
 result={'edition':edition,'startedAt':now(),'offerPagesFetched':0}
 try:
  origin=f'https://{edition}.fashionjobs.com';final,home,hh=fetch(origin+'/');nav=Nav();nav.feed(home)
  if not nav.links:raise RuntimeError('DIRECTORY_LINK_NOT_FOUND')
  target=urllib.parse.urljoin(final,nav.links[0]);result.update(homeUrl=final,homeHash=hh,url=target)
  actual,body,bh=fetch(target);result.update(finalUrl=actual,pageHash=bh,completedAt=now(),state='FETCHED_PENDING_PARSER')
  (root/f'{edition}.html').write_text(body)
 except Exception as e:result.update(state='UNRESOLVED',error=f'{type(e).__name__}: {str(e)[:200]}')
 return result
log=root/'fetch-results.jsonl';done=set()
if log.exists():done={json.loads(l)['edition'] for l in log.read_text().splitlines() if l and json.loads(l)['state']=='FETCHED_PENDING_PARSER'}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for r in pool.map(run,[h for h in hosts if h not in done]):
  with log.open('a') as f:f.write(json.dumps(r)+'\n')
  print(json.dumps(r),flush=True)
