import json,csv,pathlib,collections,datetime,unicodedata,re,hashlib
root=pathlib.Path(__file__).parent;p=root/'evidence';out=root/'tableaux';out.mkdir(exist_ok=True)
def read(n):return json.loads((p/(n+'.json')).read_text())
def writecsv(n,rows):
 rows=list(rows)
 if not rows:return
 with (out/(n+'.csv')).open('w',newline='',encoding='utf-8-sig') as f:
  w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
def simple(x):return '|'.join(str(i) for i in x) if isinstance(x,list) else x
jobs=read('job-metadata');active=[j for j in jobs if j['isActive']];jm={j['id']:j for j in jobs};cs=read('companies');cm={c['id']:c for c in cs};ss=read('sources');sm={s['key']:s for s in ss};js=read('job-sources');by=collections.defaultdict(set)
for s in js:
 if s['isActive'] and jm[s['jobId']]['isActive']:by[s['sourceKey']].add(s['jobId'])
cut=datetime.datetime.fromisoformat('2026-09-06T15:57:38.369399');runs={r['sourceKey']:r for r in read('latest-runs')}
merged={r['job']['id'] for r in read('merged-oracle-id-conflicts')};badbrand={r['id'] for r in read('smcp-brand-rows') if r['raw_brand'] and r['raw_brand']!='Sandro'}
wrongidentity={j['id'] for j in active if cm[j['companyId']]['name'] in ['VIA','ASHOKA']}
# Conservative adjudication: same employer + same posting URL + same title/city/content;
# exclude all Tiffany clusters (known cross-requisition corruption) and Aroma-Zone (different text).
confirmed=[];adjud=[]
for i,g in enumerate(read('duplicates-exact-url')):
 certain=g[0]['company'] not in ['Tiffany & Co.','Aroma-Zone'] and len({j['description_hash'] for j in g})==1 and len({j['title'] for j in g})==1 and len({(j['city'],j['countryCode'])for j in g})==1
 if certain:confirmed+=g
 for j in g:adjud.append({'cluster':i+1,'verdict':'MEME_PAGE_ANNONCE_CONFIRMEE' if certain else 'REVUE_IDENTITE_CONTENU_NECESSAIRE','id':j['id'],'company':j['company'],'title':j['title'],'country':j['countryCode'],'city':j['city'],'url':j['url'],'externalId':j['externalId'],'description_hash':j['description_hash']})
confirmed_ids={j['id'] for j in confirmed}
writecsv('doublons-urls-revue',adjud)
writecsv('fusions-identifiants-oracle',[{'jobId':r['job']['id'],'titre_canonique':r['job']['title'],'pays_canonique':r['job']['countryCode'],'url_canonique':r['job']['url'],'sources':json.dumps(r['sources'],ensure_ascii=False)} for r in read('merged-oracle-id-conflicts')])
writecsv('pays-production',read('countries'))
writecsv('entreprises-production',[{k:simple(v) for k,v in c.items()} for c in cs])
writecsv('marques-smcp-mal-rattachees',[r for r in read('smcp-brand-rows') if r['id'] in badbrand])
writecsv('france-ecart-canonique-filtre',read('france-flag-mismatch'))
writecsv('pays-france-cas-a-revoir',read('france-location-review'))
writecsv('dates-futures',read('future-dates'));writecsv('expiration-declaree-depassee',read('expired-active'))
writecsv('confiance-champs-sources',read('trust'))
links=read('company-source-links');covered={x['companyId'] for x in links if x['status']=='ACTIVE'}
writecsv('entreprises-sans-empreinte-source-active',[c for c in cs if c['id'] not in covered])
source_rows=[]
for s in ss:
 ids=by[s['key']];old={i for i in ids if datetime.datetime.fromisoformat(jm[i]['lastSeenAt'])<cut};unknown={i for i in ids if not jm[i]['countryCode']};expiry={i for i in ids if jm[i]['validThrough'] and jm[i]['validThrough']<'2026-09-08T15:57:38'};future={i for i in ids if jm[i]['postedAt'] and jm[i]['postedAt']>'2026-09-09T15:57:38'}
 review=old|unknown|expiry|future|(ids&merged)|(ids&badbrand)|(ids&wrongidentity)|(ids&confirmed_ids)
 r=runs.get(s['key'],{});source_rows.append({'sourceKey':s['key'],'label_catalogue':s['maison'],'status_catalogue':s['status'],'adaptateur':s['kind'],'tier_declare':s['tier'],'tenantKey':s['tenantKey'],'domaine_carriere':s['careersDomain'],'config_publique':json.dumps(s['config'],ensure_ascii=False),'offres_actives':len(ids),'offres_FR_canonique':sum(jm[i]['countryCode']=='FR' for i in ids),'a_revoir_union_sans_double_compte':len(review),'sans_pays':len(unknown),'sans_reobservation_48h':len(old),'validThrough_passe':len(expiry),'fusions_oracle':len(ids&merged),'mauvaise_marque_SMCP':len(ids&badbrand),'homonymes_hors_secteur':len(ids&wrongidentity),'copies_meme_page':len(ids&confirmed_ids),'dernier_run':r.get('ranAt'),'statut_run':r.get('status'),'run_complet':r.get('complete'),'peut_attester_absence':r.get('canAttestAbsence'),'jobs_run':r.get('jobs'),'total_declare':r.get('declaredTotal'),'robots_verdict':s['robotsVerdict'],'note_run':r.get('note')})
source_rows.sort(key=lambda x:(x['status_catalogue']!='ACTIVE',-x['a_revoir_union_sans_double_compte']))
writecsv('sources-et-risques',source_rows)
for label in ['fhcm','catwalks']:
 records=read(label+'-coverage')
 # Reviewed semantic match, not an automatic fuzzy rule.
 for r in records:
  if label=='catwalks' and r['name']=='Loewe Perfumes':
   matches=[c for c in cs if c['name']=='Perfumes Loewe'];r['match']='ALIAS_REVU';r['companies']=[{'id':c['id'],'name':c['name'],'active':c['active']} for c in matches]
  if label=='catwalks' and r['name']=='Maje':r['match']='IDENTITE_PRESENTE_OFFRES_RATTACHEES_A_SANDRO'
 writecsv(label+'-couverture',[{'nom':r['name'],'preuve_reference':r['referenceUrl'],'rapprochement':r['match'],'entites_base':' | '.join(c['name'] for c in r['companies']),'ids_base':' | '.join(c['id'] for c in r['companies']),'offres_sous_ces_identites':sum(c['active']for c in r['companies'])}for r in records])
# Document SQL three-valued logic correction, using the same complete snapshot.
tot=read('totals')[0].copy();tot['initial_sql_null_comparison_count']=tot.pop('france_flag_disagreement');tot['france_flag_disagreement']=sum(j['isFrance']!=(j['countryCode']=='FR') for j in active)
(p/'totals-corrected.json').write_text(json.dumps([tot],ensure_ascii=False,indent=2))
summary={'confirmed_url_clusters':len({x['cluster']for x in adjud if x['verdict']=='MEME_PAGE_ANNONCE_CONFIRMEE'}),'confirmed_url_rows':len(confirmed),'confirmed_excess':len(confirmed)-len({x['cluster']for x in adjud if x['verdict']=='MEME_PAGE_ANNONCE_CONFIRMEE'}),'source_adapter_families':len({s['kind']for s in ss if s['status']=='ACTIVE'}),'sources_tiers':dict(collections.Counter(s['tier']for s in ss if s['status']=='ACTIVE')),'company_ats_types':dict(collections.Counter(c['atsType']for c in cs)),'smcp_wrong_brand':len(badbrand),'source_risk_top10':source_rows[:10]}
(p/'delivery-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2));print({k:v for k,v in summary.items()if k!='source_risk_top10'})
# Minimal deploy metadata, no environment secrets. Retain the sanitized evidence
# when rebuilding offline after removal of the audit's temporary API response.
status_path=pathlib.Path('/tmp/catwalks-reaudit-status.json')
if status_path.exists():
 d=json.loads(status_path.read_text());names={e['node']['id']:e['node']['name']for e in d['services']['edges']};deploy=[]
 for env in d['environments']['edges']:
  for e in env['node']['serviceInstances']['edges']:
   n=e['node'];m=(n.get('latestDeployment')or{}).get('meta')or{};deploy.append({'service':names.get(n.get('serviceId')),'cronUTC':n.get('cronSchedule'),'commit':m.get('commitHash')})
 (p/'deployment-sanitized.json').write_text(json.dumps(deploy,ensure_ascii=False,indent=2))
