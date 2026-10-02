"""R-143 §6 — 30 reconnaissances changées tirées au hasard (graine fixe), avec la preuve native qui les décide, pour relecture à la main.
python3 relecture-30.py <echantillon.json.jsonl> <rejeu-avant.json> <rejeu-apres.json>"""
import json, sys, random, re, unicodedata
ech, av, ap = sys.argv[1:4]
A, B = json.load(open(av)), json.load(open(ap))
ids = sorted(i for i in A if A[i]['employmentTerm'] != B[i]['employmentTerm'])
random.seed(20261002); tirage = random.sample(ids, min(30, len(ids)))
rows = {}
for l in open(ech):
    o = json.loads(l)
    if o['id'] in tirage: rows[o['id']] = o
up = lambda t: unicodedata.normalize('NFKD', t or '').encode('ascii', 'ignore').decode().upper()
MOTS = r"\bCDI\b|\bCDD\b|DUREE (IN)?DETERMINEE|TEMPO (IN)?DETERMINATO|BEFRISTET|INDEFINIDO|CONTRATO TEMPORAL|VAST|TIJDELIJK|PERMANENT|FIXED[ -]TERM|TEMPORARY|INTERIM"
for n, i in enumerate(tirage, 1):
    o = rows[i]; d = up(o['description'])
    ctx = [d[max(0, m.start()-70):m.end()+40].replace('\n', ' ') for m in re.finditer(MOTS, d)][:3]
    print(f"{n:2}. [{o['fournisseur']}/{o['marche']}] {o['title'][:70]!r} · contrat source={o['contract']!r} · raw.contract_type={(o['raw'] or {}).get('contract_type') if isinstance(o['raw'], dict) else None}")
    print(f"    {A[i]['employmentTerm']} → {B[i]['employmentTerm']}")
    for c in ctx: print(f"      … {c} …")
