"""R-143 §6 — couverture du contrat avant / après sur l'échantillon rejoué (rejeu-contrat.mts), par marché et fournisseur.
python3 comparer-rejeu.py <echantillon.json.jsonl> <rejeu-avant.json> <rejeu-apres.json>"""
import json, sys, collections
ech, av, ap = sys.argv[1:4]
stocke = {}
for l in open(ech):
    o = json.loads(l); stocke[o['id']] = o
A, B = json.load(open(av)), json.load(open(ap))
def contrat(r): return r['employmentTerm'] is not None
def unifie(r): return r['employmentTerm'] is not None or r['programType'] is not None or r['engagementType'] in ('FREELANCE', 'INDEPENDENT_CONTRACTOR')
def tableau(cle, seuil=0):
    g = collections.defaultdict(lambda: [0, 0, 0, 0, 0, 0, 0])
    for i, r in A.items():
        k = cle(r); b = B[i]; s = stocke[i]
        t = g[k]; t[0] += 1; t[1] += s['employmentTerm'] is not None; t[2] += contrat(r); t[3] += contrat(b)
        t[4] += unifie(r); t[5] += unifie(b)
    lignes = sorted(g.items(), key=lambda kv: -kv[1][0])
    print(f"{'':28} {'n':>6} {'stocké':>7} {'avant':>7} {'après':>7} {'unif.av':>8} {'unif.ap':>8}")
    tot = [0]*7
    for k, t in lignes:
        for j in range(7): tot[j] += t[j]
        if t[0] >= seuil: print(f"{k:28} {t[0]:6} {100*t[1]/t[0]:6.1f}% {100*t[2]/t[0]:6.1f}% {100*t[3]/t[0]:6.1f}% {100*t[4]/t[0]:7.1f}% {100*t[5]/t[0]:7.1f}%")
    print(f"{'TOTAL':28} {tot[0]:6} {100*tot[1]/tot[0]:6.1f}% {100*tot[2]/tot[0]:6.1f}% {100*tot[3]/tot[0]:6.1f}% {100*tot[4]/tot[0]:7.1f}% {100*tot[5]/tot[0]:7.1f}%")
print('== par marché (contrat = durée ; unif. = la facette « contrat » des 41 marchés)'); tableau(lambda r: r['marche'], 100)
print('== par fournisseur'); tableau(lambda r: r['fournisseur'], 50)
tr = collections.Counter((A[i]['employmentTerm'], B[i]['employmentTerm'], A[i]['fournisseur']) for i in A if A[i]['employmentTerm'] != B[i]['employmentTerm'])
print('== transitions avant → après (durée), par fournisseur'); [print(f"{n:5}  {a} → {b}  {f}") for (a, b, f), n in tr.most_common(40)]
