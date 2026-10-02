"""R-143 §8 — synthèse de la mesure à blanc (alertes-a-blanc.mts) : offres envoyées avant / après, violations par critère.
python3 synthese-alertes.py <alertes-a-blanc-resultats.json>"""
import json, sys, collections
R = json.load(open(sys.argv[1]))
err = [r for r in R if 'erreur' in r]
ok = [r for r in R if 'erreur' not in r]
par = collections.defaultdict(lambda: collections.Counter())
viol_ex = collections.defaultdict(list)
for r in ok:
    o = r['origine']; p = par[o]; w = r.get('inscrits', 1)
    p['alertes'] += 1; p['inscrits'] += w
    p['avant_nouvelles'] += r['avant']['nouvelles'] * w; p['apres_nouvelles'] += r['apres']['nouvelles'] * w
    p['avant_envoyees_examinees'] += r['avant']['envoyees']; p['memes_offres'] += r['memesOffres']
    p['avec_nouvelles'] += r['avant']['nouvelles'] > 0
    for c, ids in r['violations'].items():
        p[f'violations {c}'] += len(ids); p[f'alertes touchées {c}'] += 1
        viol_ex[c].append((r['criteres'], ids[:3]))
print(f"{len(R)} alertes, {len(err)} en erreur {[e['erreur'][:60] for e in err][:3]}")
for o, p in par.items():
    print(f"== {o}"); [print(f"   {k}: {v}") for k, v in sorted(p.items())]
for c, ex in viol_ex.items():
    print(f"== exemples {c}"); [print('  ', json.dumps(cr, ensure_ascii=False), ids) for cr, ids in ex[:4]]
