import json,pathlib,html.parser,re,unicodedata,csv
p=pathlib.Path(__file__).parent/'evidence';companies=json.loads((p/'companies.json').read_text())
def norm(s):return re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',s.lower()).encode('ascii','ignore').decode())
class Anchors(html.parser.HTMLParser):
 def __init__(self):super().__init__();self.rows=[];self.current=None
 def handle_starttag(self,tag,attrs):
  if tag=='a':self.current=[dict(attrs).get('href',''),'']
 def handle_data(self,data):
  if self.current:self.current[1]+=data
 def handle_endtag(self,tag):
  if tag=='a' and self.current:self.rows.append(self.current);self.current=None
for label in ['fhcm','catwalks']:
 parser=Anchors();parser.feed((p/(label+'-maisons.html')).read_text());seen=set();out=[]
 for url,name in parser.rows:
  if not url.startswith('/fr/maison/' if label=='fhcm' else '/maisons/'):continue
  if url in seen:continue
  seen.add(url);name=' '.join(name.split());name=re.sub(r'\s*\d+ offres? disponible.*$','',name)
  # Catwalks includes the same name as screen-reader/visible duplicate on some cards.
  if len(name)%2==0 and name[:len(name)//2]==name[len(name)//2:]:name=name[:len(name)//2]
  elif len(name)%2==1 and name[:len(name)//2]==name[len(name)//2+1:]:name=name[:len(name)//2]
  keys=[norm(name),norm(url.split('/')[-1])]
  exact=[c for c in companies if norm(c['name']) in keys or norm(c.get('canonicalKey') or '') in keys]
  possible=[c for c in companies if not exact and any(len(k)>5 and len(norm(c['name']))>5 and (k in norm(c['name']) or norm(c['name']) in k) for k in keys)]
  matches=exact or possible
  out.append({'name':name,'referenceUrl':('https://www.fhcm.paris' if label=='fhcm' else 'https://catwalks.io')+url,'match':'EXACT_NORMALISE' if exact else 'POSSIBLE_A_REVOIR' if possible else 'NON_RETROUVE','companies':[{'id':c['id'],'name':c['name'],'active':c['active']} for c in matches]})
 (p/(label+'-coverage.json')).write_text(json.dumps(out,ensure_ascii=False,indent=2))
 print(label,len(out),'nontrouve',sum(x['match']=='NON_RETROUVE' for x in out))
 print([(x['name'],x['match'],[(c['name'],c['active']) for c in x['companies']]) for x in out if x['match']!='EXACT_NORMALISE' or not any(c['active'] for c in x['companies'])])
