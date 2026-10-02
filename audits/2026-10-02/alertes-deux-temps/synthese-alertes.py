"""D-515 §2 — synthèse de la mesure à blanc (alertes-a-blanc.mts) : par famille d'alertes, offres certaines et incomplètes,
alertes qui n'ont que de l'incomplet, violations par critère.
python3 synthese-alertes.py <alertes-a-blanc.json>"""
import json, sys, collections
R = json.load(open(sys.argv[1]))
err = [r for r in R if 'erreur' in r]
ok = [r for r in R if 'erreur' not in r]
print(f"{len(R)} alertes, {len(err)} en erreur {[e['erreur'][:80] for e in err][:3]}")
par = collections.defaultdict(collections.Counter)
viol = collections.Counter(); ex = collections.defaultdict(list)
for r in ok:
    p = par[r['origine']]; w = r.get('inscrits', 1)
    p['alertes'] += 1; p['inscrits'] += w
    p['certaines (nouvelles)'] += r['certaines']; p['incomplètes (nouvelles)'] += r['incompletes']
    p['alertes avec certaines'] += r['certaines'] > 0; p['alertes avec incomplètes'] += r['incompletes'] > 0
    p['alertes SANS certaine mais avec incomplètes'] += r['certaines'] == 0 and r['incompletes'] > 0
    p['offres relues (certaines + incomplètes)'] += r['certainesLues'] + r['incompletesLues']
    for c, ids in r['violations'].items():
        viol[c] += len(ids); ex[c].append((r['criteres'], ids[:3]))
for o, p in par.items():
    print(f"== {o}")
    for k, v in p.items(): print(f"   {k}: {v}")
print(f"== violations : {sum(viol.values())}")
for c, n in viol.items():
    print(f"   {c}: {n}")
    for cr, ids in ex[c][:3]: print('     ', json.dumps(cr, ensure_ascii=False), ids)
print("== par alerte de la grille (certaines / incomplètes)")
for r in ok:
    if r['origine'] != 'conversion':
        c = r['criteres']; f = c['filtres']
        print(f"   {r['origine']:24} {c['marche']} {(f.get('metier') or [''])[0]:22} {(f.get('ville') or [c['lieu']])[0]:16} {r['certaines']:5} / {r['incompletes']:5}  {r['dimensions']}")
