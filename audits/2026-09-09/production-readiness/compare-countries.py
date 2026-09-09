import json,urllib.request,hashlib,datetime,pathlib
root=pathlib.Path(__file__).parent
snapshot=json.loads((root/'production-snapshot.json').read_text());counts={r['countryCode']:r['active'] for r in snapshot['countries']};rows=[]
for country in ['FR','US','GB','DE','IT','ES','CA']:
 url='https://modecareers.com/api/jobs?pays='+country
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'CatwalksProductionAudit/1.0'}),timeout=45) as r:
  body=r.read();data=json.loads(body)
  rows.append({'country':country,'url':url,'status':r.status,'database':counts[country],'api':data['total'],'delta':data['total']-counts[country],'world':data['totalInDatabase'],'firstPageRows':len(data['jobs']),'firstPageWrongCountryIds':[j['id'] for j in data['jobs'] if j['countryCode']!=country],'sha256':hashlib.sha256(body).hexdigest()})
proof={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'databaseSnapshotAt':snapshot['at'],'scope':'API totals and first page country values; no full pagination replay','countries':rows}
(root/'country-api-proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(rows))
if any(r['delta'] or r['firstPageWrongCountryIds'] for r in rows):raise SystemExit('Mismatch: inspect evidence')
