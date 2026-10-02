"""D-515 §3 — couverture de la durée (« CDI » et ses équivalents) par marché : stockée en base, rejouée avec le code d'avant
(origin/development du 02/10, R-143 §6 compris) et avec le code d'après, sur l'échantillon 1/8 servi.
python3 comparer-marche.py <echantillon.jsonl> <rejeu-avant.json> <rejeu-apres.json>"""
import json, sys, collections
_, ech, av, ap = sys.argv
A, B = json.load(open(av)), json.load(open(ap))
g = collections.defaultdict(lambda: [0, 0, 0, 0, 0, 0])
for i, a in A.items():
    b = B[i]; t = g[a['marche']]
    t[0] += 1; t[1] += a['stocke'] is not None; t[2] += a['employmentTerm'] is not None; t[3] += b['employmentTerm'] is not None
    t[4] += b['employmentTerm'] == 'PERMANENT'; t[5] += (a['employmentTerm'] or '') != (b['employmentTerm'] or '')
tot = [sum(t[j] for t in g.values()) for j in range(6)]
print(f"{'marché':8} {'n':>6} {'stocké':>7} {'avant':>7} {'après':>7} {'perm.ap':>8} {'changés':>8}")
for k, t in sorted(g.items(), key=lambda kv: -kv[1][0]) + [('TOTAL', tot)]:
    print(f"{k:8} {t[0]:6} {100*t[1]/t[0]:6.1f}% {100*t[2]/t[0]:6.1f}% {100*t[3]/t[0]:6.1f}% {t[4]:8} {t[5]:8}")
tr = collections.Counter((A[i]['employmentTerm'], B[i]['employmentTerm'], A[i]['marche']) for i in A if A[i]['employmentTerm'] != B[i]['employmentTerm'])
print('== transitions avant → après (durée), par marché'); [print(f"{n:5}  {a} → {b}  {m}") for (a, b, m), n in tr.most_common(40)]
