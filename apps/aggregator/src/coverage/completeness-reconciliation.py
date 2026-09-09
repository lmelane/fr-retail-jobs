"""One current list of sources to investigate for feed completeness, reconciled with the earlier baseline.
Receipts: latest per source across every probe directory; 'ever complete' = any FETCH_COMPLETE receipt.
Previous 38 dossiers (handoff §6) are matched by source key or maison; nothing is added up without reconciliation."""
import json,glob,csv,pathlib,unicodedata,re,collections
B=pathlib.Path('backups/lot4-20260909');snap=json.load(open(B/'tracker-snapshot-20260909b.json'))
sources={s['key']:s for s in snap['sources']};runs={r['sourceKey']:r for r in snap['latestRuns']}
import subprocess
_REVDATES={}
def revdate(rev):
    if not rev: return 0
    if rev not in _REVDATES:
        out=subprocess.run(['git','show','-s','--format=%ct',rev],capture_output=True,text=True)
        _REVDATES[rev]=int(out.stdout.split()[0]) if out.returncode==0 and out.stdout.strip() else 0
    return _REVDATES[rev]
def rank(r): return (revdate(r.get('revision')), r.get('finishedAt') or r.get('startedAt') or '')
latest={};ever=set();all_receipts=collections.defaultdict(list)
for d in glob.glob(str(B/'source-probes*')):
    for f in glob.glob(d+'/*.receipt.json'):
        r=json.load(open(f));r['receiptFile']=str(f);k=r['sourceKey'];all_receipts[k].append(r)
        if r.get('status')=='FETCH_COMPLETE': ever.add(k)
        if k not in latest or rank(r)>rank(latest[k]): latest[k]=r
PREVIOUS=['Alberto','Pandora','Swatch','PVH','Element6','Magnet','Attaquer','Oniverse','Zegna','Lacoste','Foot Locker','Oska','Gant','The Kooples','NARS','Eram','END','Aéropostale','Aeropostale','Luxe Talent','LuxExperience','Psycho Bunny','URBN','Brown Thomas','Kastner','Nocibé','Nocibe','Bevilles','Beiersdorf','Nordstrom','Lumentee','Rituals','Boots','Marc O’Polo',"Marc O'Polo",'Capri','Michael Kors','Mango','Globus','Aigle','Kering','Lagardère','Lagardere']
norm=lambda x:re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',x or '').encode('ascii','ignore').decode().lower())
prev_norm={norm(x) for x in PREVIOUS}
def in_previous(s):
    m=norm(s['maison']);k=norm(s['key'])
    return any(pn and (pn in m or pn in k) for pn in prev_norm)
rows=[]
for k,s in sources.items():
    if s['status']!='ACTIVE': continue
    rc=latest.get(k);run=runs.get(k)
    latest_complete=bool(rc and rc.get('status')=='FETCH_COMPLETE')
    run_complete=bool(run and run.get('complete') is True and not run.get('truncated') and (run.get('errors') or 0)==0)
    prev=in_previous(s)
    if rc is None: cat='NO_RECEIPT'
    elif latest_complete: cat='RESOLVED_SINCE_BASELINE' if prev else 'COMPLETE'
    else: cat=('STILL_PARTIAL' if prev else ('REGRESSED_AFTER_COMPLETE' if k in ever else 'NEW_PARTIAL'))
    rows.append({'key':k,'maison':s['maison'],'kind':s['kind'],'tenantKey':s['tenantKey'],'category':cat,'inPreviousDossiers':prev,'everComplete':k in ever,
      'latestReceipt':rc and {'status':rc.get('status'),'at':rc.get('finishedAt'),'fetched':rc.get('fetched'),'uniqueIds':rc.get('uniqueIds'),'declaredTotal':rc.get('declaredTotal'),'complete':rc.get('complete'),'truncated':rc.get('truncated'),'missingInDatabase':len(rc.get('missingInDatabase') or []),'activeDatabaseAbsentAtSource':len(rc.get('activeDatabaseAbsentAtSource') or []),'revision':rc.get('revision'),'configHash':rc.get('configHash'),'receiptFile':rc.get('receiptFile')},
      'receiptCount':len(all_receipts[k]),'latestRun':run and {'status':run.get('status'),'at':run.get('ranAt'),'fetched':run.get('fetched'),'accepted':run.get('accepted'),'declaredTotal':run.get('declaredTotal'),'complete':run.get('complete'),'truncated':run.get('truncated'),'errors':run.get('errors')},'runComplete':run_complete,
      'config':s['config'],'lastRunJobs':s.get('lastRunJobs')})
todo=[r for r in rows if r['category'] in ('STILL_PARTIAL','REGRESSED_AFTER_COMPLETE','NEW_PARTIAL','NO_RECEIPT')]
summary={'activeSources':len(rows),'everCompleteActive':sum(r['everComplete'] for r in rows),'everCompleteAnyStatus':len(ever),'everCompleteNowInactive':sorted(k for k in ever if sources.get(k,{}).get('status')!='ACTIVE'),
 'latestReceiptComplete':sum(1 for r in rows if r['latestReceipt'] and r['latestReceipt']['status']=='FETCH_COMPLETE'),'categories':dict(collections.Counter(r['category'] for r in rows)),
 'previousDossiersMatchedActive':sum(r['inPreviousDossiers'] for r in rows),'previousStillPartial':sorted(r['key'] for r in rows if r['category']=='STILL_PARTIAL'),'previousResolved':sorted(r['key'] for r in rows if r['category']=='RESOLVED_SINCE_BASELINE'),
 'regressed':sorted(r['key'] for r in rows if r['category']=='REGRESSED_AFTER_COMPLETE'),'newPartial':sorted(r['key'] for r in rows if r['category']=='NEW_PARTIAL'),'noReceipt':sorted(r['key'] for r in rows if r['category']=='NO_RECEIPT'),'toInvestigate':len(todo)}
json.dump({'summary':summary,'sources':rows},open(B/'completeness-reconciliation.json','w'),indent=1,ensure_ascii=False)
out=pathlib.Path('audits/2026-09-09/lot4-world-coverage/tracker-v3');out.mkdir(exist_ok=True)
with (out/'completeness-to-investigate.csv').open('w') as f:
    w=csv.writer(f);w.writerow(['Clé','Maison','Kind','Tenant','Catégorie','Dans les 38 dossiers','Déjà complète un jour','Dernier reçu (statut)','Reçu le','fetched','ids uniques','déclaré','manquants en base','en base absents à la source','Nb reçus','Dernier run (statut · complete · date)','Offres au dernier run'])
    for r in sorted(todo,key=lambda r:(r['category'],r['key'])):
        rc=r['latestReceipt'] or {};run=r['latestRun'] or {}
        w.writerow([r['key'],r['maison'],r['kind'],r['tenantKey'],r['category'],'oui' if r['inPreviousDossiers'] else 'non','oui' if r['everComplete'] else 'non',rc.get('status',''),(rc.get('at') or '')[:19],rc.get('fetched',''),rc.get('uniqueIds',''),rc.get('declaredTotal',''),rc.get('missingInDatabase',''),rc.get('activeDatabaseAbsentAtSource',''),r['receiptCount'],f"{run.get('status','')} · {run.get('complete','')} · {(run.get('at') or '')[:10]}",r['lastRunJobs']])
json.dump(summary,open(out/'completeness-summary.json','w'),indent=2,ensure_ascii=False)
print(json.dumps(summary,indent=1,ensure_ascii=False))
