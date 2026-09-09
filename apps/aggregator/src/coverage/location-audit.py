"""Measure multi-location RAW structures; paths are candidates, never country assignments."""
import argparse,collections,gzip,json,pathlib
p=argparse.ArgumentParser();p.add_argument('receipts');p.add_argument('output');a=p.parse_args();stats={};jobsSeen=0

def walk(v,path='',depth=0):
 if depth>7:return
 if isinstance(v,dict):
  for k,value in v.items():
   here=path+'.'+k if path else k
   if isinstance(value,list) and len(value)>1 and any(token in k.lower() for token in ['location','office','address']):yield here,value
   elif isinstance(value,dict):yield from walk(value,here,depth+1)
for f in pathlib.Path(a.receipts).glob('*.json.gz'):
 result=json.loads(gzip.decompress(f.read_bytes()));key=f.name[:-8]
 for job in result.get('jobs',[]):
  jobsSeen+=1
  for path,values in walk(job.get('raw',{})):
   index=key+'|'+path;entry=stats.setdefault(index,{'sourceKey':key,'path':'raw.'+path,'jobs':0,'maxLocations':0,'samples':[]})
   entry['jobs']+=1;entry['maxLocations']=max(entry['maxLocations'],len(values))
   if len(entry['samples'])<2:entry['samples'].append({'externalId':job.get('externalId'),'title':job.get('title'),'locations':values[:4]})
rows=sorted(stats.values(),key=lambda r:-r['jobs']);pathlib.Path(a.output).write_text(json.dumps({'jobsRead':jobsSeen,'candidates':rows},ensure_ascii=False,indent=2));print('jobsRead',jobsSeen,'source/path pairs',len(rows));print([{k:r[k] for k in ['sourceKey','path','jobs','maxLocations']} for r in rows[:20]])
