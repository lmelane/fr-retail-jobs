import pathlib,urllib.request,json,re,html.parser,datetime
p=pathlib.Path(__file__).parent/'evidence'
class A(html.parser.HTMLParser):
 def __init__(self):super().__init__();self.a=[];self.c=None
 def handle_starttag(self,t,attrs):
  if t=='a':self.c=[dict(attrs).get('href',''),'']
 def handle_data(self,d):
  if self.c:self.c[1]+=d
 def handle_endtag(self,t):
  if t=='a' and self.c:self.a.append(self.c);self.c=None
urls=['https://www.aesop.fr/careers.html','https://www.thombrowne.com/en-mo/pages/contact','https://groupe-novi.com/nous-rejoindre/','https://rejoindrenotreequipage.saint-james.com/','https://jobs.eu.lever.co/jacquemus','https://www.rouje.com/pages/marque-employeur','https://www.driesvannoten.com/en-eu/pages/career-open-positions']
out=[]
for u in urls:
 rec={'url':u,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  with urllib.request.urlopen(u,timeout=12) as r:s=r.read(2500000).decode('utf8','replace');rec['status']=r.status
  a=A();a.feed(s);rec['careerLinks']=[{'url':h,'label':' '.join(t.split())[:140]} for h,t in a.a if re.search(r'career|recrut|offres|vacanc|opportun|jobs|postes|candidat|lever|workday|talent|smartrecruiter',h+' '+t,re.I) and not h.startswith('mailto:')];rec['atsSignatures']=[k for k in ['werecruit','teamtailor','workday','lever','smartrecruiters','fashionjobs','jobtrain','talentsoft','softgarden'] if k in s.lower()]
 except Exception as e:rec['error']=type(e).__name__
 out.append(rec);print(u,rec.get('status'),rec.get('atsSignatures'),flush=True)
 (p/'official-career-links.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
