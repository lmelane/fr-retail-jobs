"""D-515 §3 — 30 reconnaissances à relire à la main : les 21 offres dont la durée change entre le code d'avant et celui
d'après, puis des durées PERMANENT d'après prises hors de France (une par marché, tirage stable par l'identifiant).
Pour chacune : marché, intitulé, champ contrat de l'adaptateur, et l'extrait de la description qui porte la preuve.
python3 relecture-30.py <echantillon.jsonl> <rejeu-avant.json> <rejeu-apres.json>"""
import json, sys, re, hashlib
_, ech, av, ap = sys.argv
A, B = json.load(open(av)), json.load(open(ap))
offres = {}
for l in open(ech):
    o = json.loads(l.replace('\\\\', '\\')); offres[o['id']] = o
changes = sorted(i for i in A if A[i]['employmentTerm'] != B[i]['employmentTerm'])
vus, autres = set(), []
for i in sorted(B, key=lambda i: hashlib.md5(i.encode()).hexdigest()):
    m = B[i]['marche']
    if i in changes or m in vus or m == 'FR' or B[i]['employmentTerm'] != 'PERMANENT': continue
    vus.add(m); autres.append(i)
PREUVE = re.compile(r'正社員|無期|有期|정규직|계약직|fast stilling|tillsvidare|vast|indeterminat|unbefrist|festanstell|permanent|regular|indefinid|\bCDI\b|\bCDD\b|fixed[ -]term|temporary', re.I)
for n, i in enumerate((changes + autres)[:30], 1):
    o, a, b = offres[i], A[i], B[i]
    d = o.get('description') or ''
    m = PREUVE.search(d)
    extrait = d[max(0, m.start() - 60): m.end() + 60].replace('\n', ' ') if m else ''
    print(f"{n:2}. [{b['marche']}] {a['employmentTerm']} → {b['employmentTerm']} ({b['origine']}) · {o['title'][:70]!r} · contrat={o.get('contract')!r}")
    if extrait: print(f"      « {extrait} »")
