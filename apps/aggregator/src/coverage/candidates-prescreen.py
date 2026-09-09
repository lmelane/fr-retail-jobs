"""Offline pre-screen of technically readable candidate tenants (qualify-candidates.mts output) with the ARCHIVED research artifacts:
for each tenant, does a page on the actor's own domain link the tenant (reciprocal link), or does a page of another actor
(a group / portfolio page) name the actor? A missing own domain does not weaken an identity attested by a group's official page.
Nothing is activated; the sheet feeds the owner's identity review. Usage: candidates-prescreen.py candidates.jsonl output.csv research-dir…"""
import json, sys, csv, pathlib, re, collections, urllib.parse
cands = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
out = pathlib.Path(sys.argv[2]); dirs = sys.argv[3:]
VENDOR = re.compile(r'teamtailor|workday|smartrecruiters|lever\.co|greenhouse|icims|personio|recruitee|successfactors|eightfold|welcometothejungle|talent-soft|oraclecloud|pinpointhq|flatchr|avature|phenom|jobs\.lever|myworkdayjobs|talentrecruiter|workable', re.I)
records = {}; artifacts = {}
for d in dirs:
    f = pathlib.Path(d) / 'research.jsonl'
    if not f.exists(): continue
    for line in open(f):
        if not line.strip(): continue
        r = json.loads(line); records.setdefault(r['id'], []).append(r)
    a = pathlib.Path(d) / 'artifacts'
    if a.exists():
        for p in a.iterdir(): artifacts.setdefault(p.stem, p)
def host(u):
    try: return urllib.parse.urlsplit(u).hostname or ''
    except Exception: return ''
def text_of(sha):
    p = artifacts.get(sha)
    if not p: return ''
    try: return re.sub(r'<[^>]+>', ' ', p.read_text('utf-8', errors='replace')).lower()
    except Exception: return ''
rows = []
for c in cands:
    if c['verdict'] not in ('READABLE_WITH_POSTINGS', 'READABLE_EMPTY'): continue
    tenant_host = host(c['careersUrl']); labels = [l for l in c.get('labels', []) if l]
    reciprocal = []; group_pages = []; own_pages = 0
    for actor in c.get('actors', []):
        for r in records.get(actor, []):
            for page in r.get('pages', []):
                h = host(page.get('url', ''))
                if not h or VENDOR.search(h): continue
                txt = text_of(page.get('sha256', ''))
                if not txt: continue
                own_pages += 1
                if tenant_host and tenant_host in txt: reciprocal.append(page['url'])
                for l in labels:
                    if len(l) >= 3 and l.lower() in txt and page.get('from', '').startswith('PORTFOLIO'): group_pages.append((page['url'], l))
    status = 'RECIPROCAL_LINK_ON_ACTOR_PAGE' if reciprocal else ('NAMED_ON_GROUP_PAGE' if group_pages else ('ACTOR_PAGES_READ_NO_LINK' if own_pages else 'NO_ACTOR_PAGE_ARCHIVED'))
    rows.append({'tenantKey': c['tenantKey'], 'type': c['type'], 'portal': c['careersUrl'], 'labels': ' | '.join(labels[:4]), 'verdict': c['verdict'], 'postings': c.get('postings', ''), 'employers': ' | '.join(f'{n} ({k})' for n, k in (c.get('employers') or [])[:3]),
                 'prescreen': status, 'reciprocalPages': ' | '.join(sorted(set(reciprocal))[:2]), 'groupPages': ' | '.join(sorted({f'{u} → {l}' for u, l in group_pages})[:2]), 'actorPagesRead': own_pages,
                 'nextAction': {'RECIPROCAL_LINK_ON_ACTOR_PAGE': 'Identité attestée par le site de l’acteur : candidat DRAFT → revue périmètre/groupe → promotion', 'NAMED_ON_GROUP_PAGE': 'Identité attestée par une page de groupe/portefeuille : même chemin, sans exiger de domaine propre', 'ACTOR_PAGES_READ_NO_LINK': 'Pages lues sans lien vers le portail : revue nominative', 'NO_ACTOR_PAGE_ARCHIVED': 'Aucune page d’acteur archivée : recherche restante'}[status]})
with out.open('w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print(json.dumps({'tenants': len(rows), 'byPrescreen': dict(collections.Counter(r['prescreen'] for r in rows)), 'postingsByPrescreen': {k: sum(int(r['postings'] or 0) for r in rows if r['prescreen'] == k) for k in set(r['prescreen'] for r in rows)}, 'artifactsIndexed': len(artifacts)}, ensure_ascii=False))
