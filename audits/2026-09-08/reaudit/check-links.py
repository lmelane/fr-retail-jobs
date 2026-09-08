import json,pathlib,urllib.request,urllib.error,re,datetime,html
p=pathlib.Path(__file__).parent/'evidence'; jobs=json.loads((p/'job-metadata.json').read_text()); jm={j['id']:j for j in jobs}; targets=[]
for j in json.loads((p/'expired-active.json').read_text())[:6]:targets.append((j['id'],'validThrough_passé'))
for g in json.loads((p/'duplicates-exact-url.json').read_text())[:4]:targets.append((g[0]['id'],'URL_répétée'))
for jid in ['cmtrslaab1615pg5m8dosnymn','cmtrsla9p1610pg5mo0wtb1id','cmtpiyuzd0n3vpf5l9gudlybl']:targets.append((jid,'incohérence'))
for j in sorted([x for x in jobs if x['isActive']],key=lambda x:x['lastSeenAt'])[:3]:targets.append((j['id'],'plus_ancien_lastSeen'))
out=[]
for jid,reason in targets:
 j=jm[jid];rec={'id':jid,'reason':reason,'url':j['url'],'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 try:
  req=urllib.request.Request(j['url'],headers={'User-Agent':'Mozilla/5.0 (compatible; CatwalksReadOnlyAudit/1.0)'})
  with urllib.request.urlopen(req,timeout=12) as r:
   data=r.read(2000000).decode('utf8','replace'); rec.update(status=r.status,finalUrl=r.url)
  m=re.search(r'<title[^>]*>(.*?)</title>',data,re.S|re.I);rec['pageTitle']=html.unescape(m.group(1)) if m else None
  rec['jobPostingSchema']='JobPosting' in data
  rec['closedTextSignals']=list(set(re.findall(r'.{0,45}(?:no longer available|no longer accepting|position has been filled|job has expired|offre n.est plus disponible|offre a été pourvue).{0,80}',re.sub('<[^>]+>',' ',data),re.I)))[:4]
  rec['verdict']='INDETERMINE_200_NE_PROUVE_PAS_OUVERTURE'
 except urllib.error.HTTPError as e:rec.update(status=e.code,verdict='URL_404_A_VERIFIER' if e.code==404 else 'INDETERMINE_ERREUR_HTTP')
 except Exception as e:rec.update(status=None,error=type(e).__name__,verdict='INDETERMINE_RESEAU')
 out.append(rec);print(jid,rec.get('status'),rec.get('pageTitle','')[:90] if rec.get('pageTitle') else '',flush=True)
 (p/'live-employer-links.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
