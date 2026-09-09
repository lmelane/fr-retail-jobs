"""Resumable real-source qualification; no database writes and no invented traffic."""
import argparse,json,pathlib,subprocess,os,time,concurrent.futures,signal,hashlib
p=argparse.ArgumentParser();p.add_argument('snapshot');p.add_argument('output');p.add_argument('--concurrency',type=int,default=2);p.add_argument('--timeout',type=int,default=900);p.add_argument('--keys',default='');p.add_argument('--retry',action='store_true');a=p.parse_args()
assert 1<=a.concurrency<=4 and 30<=a.timeout<=1800
root=pathlib.Path(a.output);root.mkdir(parents=True,exist_ok=True);snapshot=json.load(open(a.snapshot));snapshot_hash=hashlib.sha256(pathlib.Path(a.snapshot).read_bytes()).hexdigest();selected=set(a.keys.split(',')) if a.keys else None
sources=[s for s in snapshot['sources'] if (s['key'] in selected if selected else s['status']=='ACTIVE')]
def one(s):
 key=s['key'];assert all(c.isalnum() or c in '-_' for c in key);receipt=root/f'{key}.receipt.json'
 if receipt.exists() and not a.retry and json.load(open(receipt)).get('snapshotHash')==snapshot_hash:return {'sourceKey':key,'status':'RESUMED_PREVIOUS_RECEIPT'}
 if s['kind']=='fashionjobs':return {'sourceKey':key,'status':'DISCOVERY_ONLY'}
 env={k:v for k,v in os.environ.items() if k not in ['DATABASE_URL','DIRECT_URL','BREVO_API_KEY','GOOGLE_INDEXING_CREDENTIALS','HEALTHCHECK_PING_URL']};env.update({'EGRESS_PROBE':'0','LOG_LEVEL':'warn'})
 with open(root/f'{key}.log','w') as log:
  child=subprocess.Popen(['node','--import','tsx','apps/aggregator/src/coverage/probe-worker.mts',a.snapshot,key,str(root)],stdout=log,stderr=log,env=env,start_new_session=True)
  try:code=child.wait(timeout=a.timeout)
  except subprocess.TimeoutExpired:
   os.killpg(child.pid,signal.SIGTERM)
   try:child.wait(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
   receipt.write_text(json.dumps({'sourceKey':key,'kind':s['kind'],'status':'PROCESS_TIMEOUT','timeoutSeconds':a.timeout,'checkedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'cause':'Real adapter did not terminate within the bounded observation window; no conclusion on source vacancy volume.','nextAction':'Inspect checkpoint/network log, distinguish transport delay from pagination/implementation defect, then rerun.'},indent=2))
 if not receipt.exists():receipt.write_text(json.dumps({'sourceKey':key,'kind':s['kind'],'status':'WORKER_FAILED','exitCode':child.returncode,'nextAction':'Inspect worker log and repair the execution error before concluding on source availability.'},indent=2))
 return json.load(open(receipt))
counts={};start=time.time()
with concurrent.futures.ThreadPoolExecutor(max_workers=a.concurrency) as pool:
 futures=[pool.submit(one,s) for s in sources]
 for i,future in enumerate(concurrent.futures.as_completed(futures),1):
  result=future.result()
  status=result['status'];counts[status]=counts.get(status,0)+1
  with open(root/'progress.jsonl','a') as f:f.write(json.dumps({'done':i,'total':len(sources),'sourceKey':result['sourceKey'],'status':status,'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})+'\n')
  if i%10==0 or i==len(sources):print(json.dumps({'done':i,'total':len(sources),'elapsedSeconds':round(time.time()-start),'statuses':counts}),flush=True)
print(json.dumps({'complete':True,'sources':len(sources),'statuses':counts}),flush=True)
