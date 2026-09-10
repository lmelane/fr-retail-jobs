"""Join dated research and fetch evidence without promoting candidates or erasing failures."""
import argparse, collections, csv, json, pathlib
p=argparse.ArgumentParser();p.add_argument('inventory');p.add_argument('output');p.add_argument('--research',nargs='*',default=[]);p.add_argument('--probes',nargs='*',default=[]);a=p.parse_args()
rows=json.load(open(a.inventory));byId={r['id']:r for r in rows};out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
research=collections.defaultdict(list)
for root in a.research:
 f=pathlib.Path(root)/'research.jsonl'
 if f.exists():
  for line in f.read_text().splitlines():
   if line.strip():
    record=json.loads(line);research[record['id']].append({**record,'artifactRoot':str(pathlib.Path(root)/'artifacts')})
probes=collections.defaultdict(list)
for root in a.probes:
 for f in pathlib.Path(root).glob('*.receipt.json'):
  r=json.load(open(f));probes[r['sourceKey']].append({**r,'receiptFile':str(f)})
for r in rows:
 r['researchPasses']=research[r['id']]
 pages={(p['url'],p['sha256']):p for step in r['researchPasses'] for p in step.get('pages',[])}
 candidates={}
 for page in pages.values():
  for c in page.get('atsCandidates',[]):
   key=json.dumps([c['type'],c.get('config')],sort_keys=True)
   entry=candidates.setdefault(key,{'ats':c['type'],'portal':c['careersUrl'],'configuration':c.get('config'), 'proofs':[],'identityCertified':False,'sourceActivated':False})
   entry['proofs'].append({'url':page['url'],'sha256':page['sha256'],'at':page.get('at')})
 r['portalCandidates']=list(candidates.values())
 r['sourceFetchEvidence']={key:sorted(probes[key],key=lambda v:v.get('finishedAt',v.get('checkedAt',''))) for key in r['sourceKeys']}
 r['status']='ATS_CANDIDATES_TO_QUALIFY' if candidates else 'CAREER_LINKS_TO_QUALIFY' if any(step.get('links') for step in r['researchPasses']) else 'OFFICIAL_PORTAL_SEARCH_REQUIRED' if pages else 'PROFILE_ONLY_WEBSITE_SEARCH_REQUIRED' if r['researchPasses'] else 'RESEARCH_NOT_RUN'
 r['nextAction']='Verify official identity and portal scope; compare independently enumerated native IDs with production and front.' if candidates else 'Continue official-domain/sector research; no absence of a portal or jobs has been established.'
 # An audited candidate, verified employer, complete tenant and complete world coverage
 # are four separate verdicts. None can be inferred from a successful name join.
 r['qualification']={'researchStarted':bool(r['researchPasses']),'identityConfirmed':False,'worldwidePortalCoverageConfirmed':False,'newSourceActivated':False}
(out/'fashionjobs-tracker.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
with (out/'fashionjobs-tracker.csv').open('w') as f:
 w=csv.writer(f);w.writerow(['ID','Libellés RAW','Éditions','Entreprises BDD candidates','Sources BDD candidates','Offres actives candidat unique','France candidat unique','Sites candidats','Portails candidats','ATS candidats','Pages lues','Erreurs documentées','Statut recherche','Identité certifiée par cette passe','Activation nouvelle source','Action restante'])
 for r in rows:
  cells=[r['id'],' | '.join(r['labels']),' | '.join(r['editions']),' | '.join(c['name'] for c in r['candidateCompanies']),' | '.join(r['sourceKeys']),r['activeJobsForSingleCandidate'],r['franceJobsForSingleCandidate'],' | '.join(r['candidateWebsites']),' | '.join(sorted({p['portal'] for p in r['portalCandidates']})),' | '.join(sorted({p['ats'] for p in r['portalCandidates']})),sum(len(x.get('pages',[])) for x in r['researchPasses']),sum(len(x.get('failures',[])) for x in r['researchPasses']),r['status'],'Non','Non',r['nextAction']]
  w.writerow(["'"+c if isinstance(c,str) and c.startswith(('=','+','-','@')) else c for c in cells])
summary={'rows':len(rows),'labels':sum(len(r['labels']) for r in rows),'researchStarted':sum(bool(r['researchPasses']) for r in rows),'statuses':dict(collections.Counter(r['status'] for r in rows)),'sourcesWithReceipts':len(probes),'independentNewIdentityCertifications':0,'newSourceActivations':0,'note':'Discovery progress only. Explicit reviewer decisions and activation records must be added separately.'}
(out/'progress-summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
